package org.switchboard.android.vault

import android.content.Context
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.JsonObject
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
    private val prefs = context.getSharedPreferences("switchboard-vault", Context.MODE_PRIVATE)
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

    /**
     * Your profile, as it stands, independent of any one network.
     *
     * A profile belongs to the person, not to a connection: it has to be
     * writable with nothing connected, and with no networks configured at all.
     * Each server keeps its own copy to publish, and takes it from here.
     */
    fun defaultProfile(): Map<String, String> =
        (payload?.settings?.get(PROFILE_KEY) as? JsonObject)
            ?.mapNotNull { (key, value) ->
                (value as? JsonPrimitive)?.contentOrNull?.let { key to it }
            }
            ?.toMap()
            .orEmpty()

    /** Write one key of the profile, and seal it */
    fun setDefaultProfileKey(key: String, value: String): Boolean {
        val profile = defaultProfile().toMutableMap()
        if (value.isEmpty()) profile.remove(key) else profile[key] = value

        return setSharedSetting(
            PROFILE_KEY,
            if (profile.isEmpty()) null else JsonObject(profile.mapValues { JsonPrimitive(it.value) })
        )
    }

    /**
     * Write one shared setting, and seal it.
     *
     * The vault is where a phone on its own keeps things too, not only where
     * they travel from: `settings:set` over the link is answered by the
     * desktop, and an unpaired phone has no desktop to answer it. Anything the
     * person should still have after a restart goes through here.
     */
    fun setSharedSetting(key: String, value: JsonElement?): Boolean {
        val current = payload ?: return false

        val settings = current.settings.toMutableMap()
        if (value == null) settings.remove(key) else settings[key] = value

        return resealPayload(current.copy(settings = settings)) != null
    }

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
        // No config yet means a fresh install, not a locked one. Make one, so
        // that adding a server is the first thing someone can do rather than
        // the thing they cannot do.
        if (envelope == null) createLocal()

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
     * Whether this config is protected by a passphrase someone chose.
     *
     * A config made on the phone is not: it is sealed with a random key the
     * hardware keystore holds, because a client that demands a passphrase
     * before it will let you type a server address is not a client. The
     * passphrase is what a *second* device needs, and it is asked for then.
     */
    val hasPassphrase: Boolean get() = prefs.getBoolean(HAS_PASSPHRASE, false)

    /**
     * Make a config for this phone, now, with nothing to type.
     *
     * The app used to have no way to make one at all — a config could only
     * arrive from a desktop over a pairing — so a phone on its own could not
     * add a server, save a profile, or do anything else. Everything was gated
     * on `vault.isUnlocked`, and there was no way to reach that state alone.
     *
     * The key is random and lives in the keystore, so this is encrypted at
     * rest and opens itself on every launch. Nobody is asked for anything.
     */
    fun createLocal(): Boolean {
        if (envelope != null) return false

        val generated = ByteArray(32).also { java.security.SecureRandom().nextBytes(it) }
        write(VaultPayload(version = 1), generated, VaultCrypto.generateSalt())
        keeper.keep(generated)
        prefs.edit().putBoolean(HAS_PASSPHRASE, false).apply()
        return true
    }

    /**
     * Put a passphrase on this config so another device can share it.
     *
     * Re-seals what is already here under a key derived from the passphrase,
     * with a fresh salt. Nothing is lost: the servers, the profile and the
     * settings carry over, so choosing to share later costs nothing.
     */
    fun setPassphrase(passphrase: String, keepOpen: Boolean = true): Boolean {
        val current = payload ?: return false

        val salt = VaultCrypto.generateSalt()
        val derived = VaultCrypto.deriveKey(passphrase, salt)
        write(current.copy(version = (envelope?.version ?: 0) + 1), derived, salt)
        if (keepOpen) keeper.keep(derived) else keeper.forget()
        prefs.edit().putBoolean(HAS_PASSPHRASE, true).apply()
        return true
    }

    /** Seal a payload under a key and make it the one we hold */
    private fun write(next: VaultPayload, underKey: ByteArray, salt: ByteArray) {
        val sealed = VaultCrypto.seal(
            payloadJson = json.encodeToString(VaultPayload.serializer(), next),
            key = underKey,
            salt = salt,
            version = next.version,
            updatedAt = Instant.now().toString(),
            updatedBy = "phone",
            iterations = KDF_ITERATIONS
        )
        envelope = sealed
        payload = next
        key = underKey
        file.writeText(VaultCrypto.encode(sealed))
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
        val current = payload ?: return null
        return resealPayload(current.copy(servers = servers), deviceName)
    }

    /** Seal a whole payload as the next version of this config */
    fun resealPayload(next: VaultPayload, deviceName: String = "phone"): VaultEnvelope? {
        val currentKey = key ?: return null
        val sealed = envelope ?: return null

        val bumped = next.copy(version = sealed.version + 1)
        val resealed = VaultCrypto.seal(
            payloadJson = json.encodeToString(VaultPayload.serializer(), bumped),
            key = currentKey,
            salt = java.util.Base64.getDecoder().decode(sealed.kdf.salt),
            version = bumped.version,
            updatedAt = Instant.now().toString(),
            updatedBy = deviceName,
            iterations = sealed.kdf.iterations
        )

        envelope = resealed
        payload = bumped
        file.writeText(VaultCrypto.encode(resealed))
        // The salt is unchanged, so the kept key still opens this — but write
        // it again rather than relying on that staying true.
        if (keeper.isKept) keeper.keep(currentKey)
        return resealed
    }

    private companion object {
        const val HAS_PASSPHRASE = "hasPassphrase"
        const val PROFILE_KEY = "profile"
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

