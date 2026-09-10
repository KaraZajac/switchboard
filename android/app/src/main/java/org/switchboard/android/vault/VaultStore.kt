package org.switchboard.android.vault

import android.content.Context
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import org.switchboard.android.irc.ServerConfig
import java.io.File
import java.time.Instant

/**
 * The shared config, on the phone.
 *
 * The envelope is written to disk exactly as it arrived — still sealed. The
 * passphrase is the only thing that opens it, and by default the key it derives
 * lives in memory and nowhere else.
 *
 * That default is safe and, for a standby device, not enough on its own: the
 * system restarts this app whenever it likes, and a phone that has to be asked
 * for a passphrase before it can take over will sit beside a dead desktop doing
 * nothing. So the key can also be kept — wrapped by the Android Keystore, never
 * written down in the clear. See [KeyKeeper] for exactly what that protects.
 *
 * This mirrors `src/main/vault/vault.ts` on the desktop, including the part that
 * matters most: a re-seal keeps the same salt, so a device that is already
 * unlocked can open the next version without asking again.
 */
class VaultStore(context: Context) {

    private val file = File(context.filesDir, "vault.json")
    private val keeper = KeyKeeper(context)

    private var key: ByteArray? = null
    private var envelope: VaultEnvelope? = null
    private var payload: VaultPayload? = null

    private val json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = true
        explicitNulls = false
    }

    val exists: Boolean get() = envelope != null
    val isUnlocked: Boolean get() = payload != null
    val version: Int get() = envelope?.version ?: 0
    val updatedBy: String? get() = envelope?.updatedBy
    val fingerprint: String? get() = key?.let { VaultCrypto.keyFingerprint(it) }

    /** Servers the phone can connect to on its own, once unlocked */
    fun servers(): List<ServerConfig> = payload?.servers.orEmpty()

    /** A setting the two devices share, as the desktop last sealed it */
    fun setting(key: String): JsonElement? = payload?.settings?.get(key)

    /** The nicks this account watches on a server, shared from the other device */
    fun watched(serverId: String): List<String> = payload?.monitor?.get(serverId).orEmpty()

    /** True when the key is being kept, so a restart does not lock us out */
    val isKeptOpen: Boolean get() = keeper.isKept

    init {
        if (file.exists()) {
            runCatching { envelope = VaultCrypto.decode(file.readText()) }
        }

        // If the user asked us to stay open, this is what makes a standby phone
        // able to take over after the system restarts it in the night.
        val sealed = envelope
        val kept = keeper.recover()
        if (sealed != null && kept != null) {
            runCatching {
                payload = json.decodeFromString(
                    VaultPayload.serializer(),
                    VaultCrypto.open(sealed, kept)
                )
                key = kept
            }.onFailure {
                // The vault was resealed under a different passphrase, or the
                // keystore entry no longer matches. Ask again rather than
                // pretending.
                keeper.forget()
            }
        }
    }

    /**
     * Try a passphrase against the vault we hold.
     *
     * Returns false rather than throwing: a mistyped passphrase is an ordinary
     * thing for a person to do, not an exceptional one.
     */
    /**
     * Start a config on this phone, with no desktop involved.
     *
     * Until this existed a vault could only ever *arrive* — from a desktop,
     * over a pairing — so a phone on its own had nowhere to keep a server and
     * could not add one. That made the desktop a requirement for using the app
     * at all, which was never the intent: the two are separate clients that
     * share a config when they are paired, not a client and its terminal.
     *
     * The passphrase is what a second device will need later. It is asked for
     * up front rather than invented here, because a config that cannot be
     * shared without being re-sealed under a new key is a worse trade than one
     * question at setup.
     *
     * Returns false only if there is already a vault — replacing one silently
     * would throw away every server on it.
     */
    fun create(passphrase: String, keepOpen: Boolean = false): Boolean {
        if (envelope != null) return false

        val salt = VaultCrypto.generateSalt()
        val derived = VaultCrypto.deriveKey(passphrase, salt)
        val first = VaultPayload(version = 1)
        val sealed = VaultCrypto.seal(
            payloadJson = json.encodeToString(VaultPayload.serializer(), first),
            key = derived,
            salt = salt,
            version = first.version,
            updatedAt = Instant.now().toString(),
            updatedBy = "phone",
            iterations = KDF_ITERATIONS
        )

        envelope = sealed
        payload = first
        key = derived
        file.writeText(VaultCrypto.encode(sealed))
        if (keepOpen) keeper.keep(derived) else keeper.forget()
        return true
    }

    fun unlock(passphrase: String, keepOpen: Boolean = false): Boolean {
        val sealed = envelope ?: return false
        return try {
            val derived = VaultCrypto.deriveKeyFor(sealed, passphrase)
            payload = json.decodeFromString(
                VaultPayload.serializer(),
                VaultCrypto.open(sealed, derived)
            )
            key = derived
            if (keepOpen) keeper.keep(derived) else keeper.forget()
            true
        } catch (e: Exception) {
            payload = null
            key = null
            false
        }
    }

    /**
     * Lock it, and stop keeping it open.
     *
     * Locking has to mean locked: leaving a wrapped key behind would have the
     * vault spring open again at the next restart, which is not what anyone
     * pressing Lock is asking for.
     */
    fun lock() {
        key?.fill(0)
        key = null
        payload = null
        keeper.forget()
    }

    /** What the desktop's import did, and why it did it, for the UI to show */
    data class Import(val accepted: Boolean, val reason: String)

    /**
     * Take a vault offered by the desktop.
     *
     * Only a strictly newer version is taken: an older one is either a stale
     * peer or an attempt to roll config back to a version whose password
     * somebody already has. An equal version is already what we hold.
     */
    fun accept(incoming: VaultEnvelope): Import {
        if (exists && incoming.version <= version) {
            return Import(false, "Ignored vault v${incoming.version}; this phone has v$version")
        }

        val currentKey = key
        if (currentKey != null) {
            // Verify it opens before replacing what is on disk. Half-applying a
            // vault is how a user ends up locked out of their own config.
            val opened = try {
                json.decodeFromString(
                    VaultPayload.serializer(),
                    VaultCrypto.open(incoming, currentKey)
                )
            } catch (e: VaultLockedException) {
                return Import(false, "That device is using a different passphrase")
            }

            envelope = incoming
            payload = opened
            file.writeText(VaultCrypto.encode(incoming))
            return Import(true, "Adopted vault v${incoming.version}")
        }

        // Locked: we cannot check it opens, but storing it is still right — the
        // user may unlock later, and refusing would leave the devices apart.
        envelope = incoming
        file.writeText(VaultCrypto.encode(incoming))
        return Import(true, "Stored vault v${incoming.version}; unlock to apply it")
    }

    /**
     * Seal the current contents under the next version.
     *
     * Keeps the envelope's existing salt, so every device that has already
     * unlocked can open the result without being asked again.
     */
    fun reseal(servers: List<ServerConfig>, deviceName: String = "phone"): VaultEnvelope? {
        val currentKey = key ?: return null
        val sealed = envelope ?: return null

        // Carry the rest of the payload forward. Servers are what this call
        // changes; the theme, the mutes and the watched nicks belong to the
        // person and would otherwise be dropped by a phone editing a server.
        val next = VaultPayload(
            version = sealed.version + 1,
            servers = servers,
            settings = payload?.settings.orEmpty(),
            monitor = payload?.monitor.orEmpty()
        )
        val resealed = VaultCrypto.seal(
            payloadJson = json.encodeToString(VaultPayload.serializer(), next),
            key = currentKey,
            salt = java.util.Base64.getDecoder().decode(sealed.kdf.salt),
            version = next.version,
            updatedAt = Instant.now().toString(),
            updatedBy = deviceName,
            iterations = sealed.kdf.iterations
        )

        envelope = resealed
        payload = next
        file.writeText(VaultCrypto.encode(resealed))
        // The salt is unchanged, so the kept key still opens this — but write
        // it again rather than relying on that staying true.
        if (keeper.isKept) keeper.keep(currentKey)
        return resealed
    }

    /** The sealed envelope, for handing to another device */
    fun sealedEnvelope(): VaultEnvelope? = envelope
}

/**
 * What is inside the vault.
 *
 * The same document the desktop seals — `{ version, servers }` — so the phone
 * deserialises exactly what `src/main/vault/vault.ts` wrote.
 */
@Serializable
data class VaultPayload(
    val version: Int = 0,
    val servers: List<ServerConfig> = emptyList(),
    /**
     * Settings both devices should agree on — the theme, and which
     * conversations are muted.
     *
     * An allowlist on the desktop side rather than everything, because not
     * every setting is about the person: a proxy address and a CA path
     * describe the machine they were typed on.
     *
     * Values are whatever JSON the setting holds, so this is a JsonElement
     * rather than a String: `mutes` is an object, `theme` is a string.
     */
    val settings: Map<String, JsonElement> = emptyMap(),
    /**
     * Watched nicks, per server id. MONITOR is per connection, so a device has
     * to be handed the list — there is nothing it can ask the server for.
     */
    val monitor: Map<String, List<String>> = emptyMap()
)
