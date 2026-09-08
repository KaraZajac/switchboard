package org.switchboard.android

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.switchboard.android.irc.Irc
import org.switchboard.android.ui.DEFAULT_PALETTE
import org.switchboard.android.ui.PALETTES
import org.switchboard.android.ui.paletteFor
import org.switchboard.android.irc.IrcConnection
import org.switchboard.android.vault.VaultCrypto
import org.switchboard.android.vault.VaultEnvelope
import org.switchboard.android.vault.VaultLockedException
import java.io.File

/**
 * The Kotlin half of the shared corpus.
 *
 * These read the JSON files in `tests/fixtures` in the desktop repo — the same files
 * `tests/main/fixtures.test.ts` reads. A protocol case that passes on both sides
 * is a case where the two clients genuinely agree, which is the only guarantee
 * worth having once the phone can be the connection instead of the desktop.
 */
class SharedCorpusTest {

    private val fixtures = File(
        System.getProperty("switchboard.fixtures")
            ?: error("switchboard.fixtures is not set; see app/build.gradle.kts")
    )

    private val json = Json { ignoreUnknownKeys = true }

    private fun load(name: String): JsonObject =
        json.parseToJsonElement(File(fixtures, name).readText()).jsonObject

    // ── IRC protocol ──────────────────────────────────────────────────

    @Test
    fun `parses every case in the shared corpus`() {
        val cases = load("irc-messages.json")["cases"]!!.jsonArray
        assertTrue("corpus should not be empty", cases.size > 10)

        for (entry in cases) {
            val case = entry.jsonObject
            val name = case["name"]!!.jsonPrimitive.content
            val message = Irc.parse(case["raw"]!!.jsonPrimitive.content)
            val expected = case["parsed"]!!.jsonObject

            assertEquals("$name: command", expected["command"]!!.jsonPrimitive.content, message.command)

            val expectedPrefix = expected["prefix"]!!.stringOrNull()
            assertEquals("$name: prefix", expectedPrefix, message.prefix)
            assertEquals("$name: nick", expected["nick"]!!.stringOrNull(), message.source?.nick)

            val expectedParams = expected["params"]!!.jsonArray.map { it.jsonPrimitive.content }
            assertEquals("$name: params", expectedParams, message.params)

            // A tag with no value is `true` in the corpus and null here; both
            // mean the same thing, so compare presence and value separately.
            val expectedTags = expected["tags"]!!.jsonObject
            assertEquals("$name: tag count", expectedTags.size, message.tags.size)
            for ((key, value) in expectedTags) {
                assertTrue("$name: tag $key is present", message.tags.containsKey(key))
                val valueless = (value as? JsonPrimitive)?.booleanOrNull == true
                if (valueless) {
                    assertNull("$name: tag $key has no value", message.tags[key])
                } else {
                    assertEquals("$name: tag $key", value.jsonPrimitive.content, message.tags[key])
                }
            }
        }
    }

    @Test
    fun `serialises every case in the shared corpus`() {
        val cases = load("irc-messages.json")["serialise"]!!.jsonArray

        for (entry in cases) {
            val case = entry.jsonObject
            val name = case["name"]!!.jsonPrimitive.content
            val line = Irc.serialise(
                case["command"]!!.jsonPrimitive.content,
                case["params"]!!.jsonArray.map { it.jsonPrimitive.content }
            )
            assertEquals(name, case["line"]!!.jsonPrimitive.content, line)
        }
    }

    @Test
    fun `a parsed line serialises back to something that parses the same`() {
        val cases = load("irc-messages.json")["cases"]!!.jsonArray

        for (entry in cases) {
            val case = entry.jsonObject
            val original = Irc.parse(case["raw"]!!.jsonPrimitive.content)
            val round = Irc.parse(Irc.serialise(original.command, original.params, original.tags))

            assertEquals(case["name"].toString(), original.command, round.command)
            assertEquals(case["name"].toString(), original.params, round.params)
            assertEquals(case["name"].toString(), original.tags, round.tags)
        }
    }

    // ── Vault interop ─────────────────────────────────────────────────

    @Test
    fun `opens a vault the desktop sealed`() {
        val fixture = load("vault-from-desktop.json")
        val envelope = VaultCrypto.decode(fixture["envelope"]!!)
        val passphrase = fixture["passphrase"]!!.jsonPrimitive.content

        val key = VaultCrypto.deriveKeyFor(envelope, passphrase)
        val opened = json.parseToJsonElement(VaultCrypto.open(envelope, key))

        assertEquals(fixture["payload"], opened)
        assertEquals(
            "the fingerprint the two devices compare must match",
            fixture["fingerprint"]!!.jsonPrimitive.content,
            VaultCrypto.keyFingerprint(key)
        )
    }

    @Test
    fun `refuses the desktop's vault with the wrong passphrase`() {
        val fixture = load("vault-from-desktop.json")
        val envelope = VaultCrypto.decode(fixture["envelope"]!!)

        val key = VaultCrypto.deriveKeyFor(envelope, "not the passphrase")
        try {
            VaultCrypto.open(envelope, key)
            error("should not have opened")
        } catch (e: VaultLockedException) {
            // expected
        }
    }

    @Test
    fun `detects a rewritten version on a desktop vault`() {
        val fixture = load("vault-from-desktop.json")
        val envelope = VaultCrypto.decode(fixture["envelope"]!!)
        val key = VaultCrypto.deriveKeyFor(envelope, fixture["passphrase"]!!.jsonPrimitive.content)

        // A peer claiming this old vault is newer than it is
        try {
            VaultCrypto.open(envelope.copy(version = 999), key)
            error("a rolled-back version should not open")
        } catch (e: VaultLockedException) {
            // expected
        }
    }

    /**
     * Seals the fixture the desktop test opens.
     *
     * The salt and IV are pinned so the file is byte-stable and regenerating it
     * on every run produces no diff — which means it *can* be regenerated on
     * every run, and the desktop's check is always against current Kotlin code
     * rather than a snapshot of it.
     */
    @Test
    fun `seals a vault the desktop can open`() {
        val passphrase = "correct horse battery staple ☕"
        val salt = ByteArray(16) { (it * 7 + 3).toByte() }
        val iv = ByteArray(12) { (it * 13 + 5).toByte() }
        val iterations = 600_000

        val payload = buildJsonObject {
            put("version", 9)
            put("servers", kotlinx.serialization.json.buildJsonArray {
                add(buildJsonObject {
                    put("id", "srv-phone")
                    put("name", "Libera")
                    put("host", "irc.libera.chat")
                    put("port", 6697)
                    put("tls", true)
                    put("nick", "kara")
                    put("saslUsername", "kara")
                    put("saslPassword", "hunter2")
                })
            })
        }

        val key = VaultCrypto.deriveKey(passphrase, salt, iterations)
        val envelope = VaultCrypto.seal(
            payloadJson = payload.toString(),
            key = key,
            salt = salt,
            version = 9,
            updatedAt = "2026-09-08T10:20:00.000Z",
            updatedBy = "phone-fixture",
            iterations = iterations,
            iv = iv
        )

        // It opens here first — a fixture that only the other side can read is
        // not evidence of anything.
        assertEquals(payload.toString(), VaultCrypto.open(envelope, key))

        val document = buildJsonObject {
            put(
                "\$comment",
                "Sealed by android VaultCrypto. tests/main/fixtures.test.ts opens this; " +
                    "if it cannot, the two vault implementations have drifted. " +
                    "Regenerated by SharedCorpusTest with a pinned salt and IV, so it is byte-stable."
            )
            put("passphrase", passphrase)
            put("payload", payload)
            put("fingerprint", VaultCrypto.keyFingerprint(key))
            put("envelope", json.parseToJsonElement(VaultCrypto.encode(envelope)))
        }

        File(fixtures, "vault-from-android.json").writeText(
            Json { prettyPrint = true }.encodeToString(JsonElement.serializer(), document) + "\n"
        )
    }

    @Test
    fun `normalises unicode passphrases the way the desktop does`() {
        val salt = ByteArray(16) { 1 }
        // "cafe" with a combining accent, versus the precomposed character
        val decomposed = "café"
        val composed = "café"

        assertTrue(
            VaultCrypto.deriveKey(composed, salt, 1000)
                .contentEquals(VaultCrypto.deriveKey(decomposed, salt, 1000))
        )
    }

    @Test
    fun `fingerprints compare without revealing the key`() {
        val salt = ByteArray(16) { 2 }
        val key = VaultCrypto.deriveKey("shared", salt, 1000)
        val same = VaultCrypto.deriveKey("shared", salt, 1000)
        val other = VaultCrypto.deriveKey("different", salt, 1000)

        assertTrue(
            VaultCrypto.fingerprintsMatch(
                VaultCrypto.keyFingerprint(key),
                VaultCrypto.keyFingerprint(same)
            )
        )
        assertFalse(
            VaultCrypto.fingerprintsMatch(
                VaultCrypto.keyFingerprint(key),
                VaultCrypto.keyFingerprint(other)
            )
        )
        assertFalse(
            VaultCrypto.keyFingerprint(key).contains(
                key.joinToString("") { "%02x".format(it) }.take(8)
            )
        )
    }

    @Test
    fun `refuses an empty passphrase rather than sealing with a weak key`() {
        try {
            VaultCrypto.deriveKey("", ByteArray(16), 1000)
            error("an empty passphrase should be refused")
        } catch (e: IllegalArgumentException) {
            assertNotNull(e.message)
        }
    }

    /** JsonNull reads as a real null here, which is what the corpus means by it */
    private fun JsonElement.stringOrNull(): String? = (this as? JsonPrimitive)?.contentOrNull

    // ── Capabilities ──────────────────────────────────────────────────

    @Test
    fun `asks for the same capabilities the desktop does`() {
        val fixture = load("capabilities.json")
        val expected = fixture["requested"]!!.jsonArray.map { it.jsonPrimitive.content }

        // Two clients that negotiate different capabilities render the same
        // channel differently, and the seam shows up exactly when one takes
        // over from the other.
        assertEquals(expected, IrcConnection.WANTED_CAPABILITIES)
    }

    @Test
    fun `never asks for a name that is not a capability`() {
        val fixture = load("capabilities.json")
        for (entry in fixture["notCapabilities"]!!.jsonArray) {
            val name = entry.jsonPrimitive.content
            assertFalse("$name is not a capability", name in IrcConnection.WANTED_CAPABILITIES)
        }

        for (cap in IrcConnection.WANTED_CAPABILITIES) {
            assertFalse("a '+' prefix names a message tag, not a capability", cap.startsWith("+"))
            assertEquals("capability names are lowercase", cap.lowercase(), cap)
        }
    }

    @Test
    fun `splits the capability request to fit the line limit`() {
        val budget = IrcConnection.MAX_LINE_BYTES - "CAP REQ :".toByteArray().size - 2

        // The same chunking the connection does, over the real wish list
        val lines = mutableListOf<String>()
        var current = ""
        for (cap in IrcConnection.WANTED_CAPABILITIES) {
            val candidate = if (current.isEmpty()) cap else "$current $cap"
            if (candidate.toByteArray().size > budget && current.isNotEmpty()) {
                lines.add(current); current = cap
            } else {
                current = candidate
            }
        }
        if (current.isNotEmpty()) lines.add(current)

        for (line in lines) {
            assertTrue(
                "a CAP REQ over the limit is answered with 417 and never connects",
                ("CAP REQ :$line").toByteArray().size + 2 <= IrcConnection.MAX_LINE_BYTES
            )
        }
        assertEquals(
            IrcConnection.WANTED_CAPABILITIES,
            lines.flatMap { it.split(" ") }
        )
    }

    // ── themes ────────────────────────────────────────────────────────

    /**
     * The phone paints with the desktop's colours.
     *
     * `Palettes.kt` is generated from the desktop's stylesheet by
     * `scripts/themes.py`. If someone edits a theme and forgets to re-run it,
     * this is what says so — otherwise the two clients drift apart one hex
     * value at a time, which nobody notices until the screenshots differ.
     */
    @Test
    fun `every theme the desktop offers is on the phone, colour for colour`() {
        val themes = load("themes.json")["themes"]!!.jsonArray
        assertEquals("theme count", themes.size, PALETTES.size)

        fun hex(colour: androidx.compose.ui.graphics.Color): String =
            "#%06x".format(colour.value.shr(32).toLong().and(0xFFFFFF))

        for ((index, entry) in themes.withIndex()) {
            val expected = entry.jsonObject
            val id = expected["id"]!!.jsonPrimitive.content
            val palette = PALETTES[index]

            assertEquals("theme order", id, palette.id)
            assertEquals("$id label", expected["label"]!!.jsonPrimitive.content, palette.label)

            val roles = expected["roles"]!!.jsonObject
            val ours = mapOf(
                "crust" to palette.crust, "mantle" to palette.mantle, "base" to palette.base,
                "surface0" to palette.surface0, "surface1" to palette.surface1,
                "muted" to palette.muted, "overlay" to palette.overlay,
                "subtext" to palette.subtext, "text" to palette.text,
                "accent" to palette.accent, "accentSoft" to palette.accentSoft,
                "good" to palette.good, "warn" to palette.warn, "bad" to palette.bad
            )
            assertEquals("$id role count", roles.size, ours.size)
            for ((role, colour) in ours) {
                assertEquals("$id $role", roles[role]!!.jsonPrimitive.content, hex(colour))
            }

            val avatars = expected["avatars"]!!.jsonArray
            assertEquals("$id avatar count", avatars.size, palette.avatars.size)
            for ((slot, colour) in palette.avatars.withIndex()) {
                assertEquals("$id avatar $slot", avatars[slot].jsonPrimitive.content, hex(colour))
            }
        }
    }

    @Test
    fun `the default theme is one we have`() {
        val default = load("themes.json")["default"]!!.jsonPrimitive.content
        assertEquals(default, DEFAULT_PALETTE.id)
        assertEquals(default, paletteFor("no-such-theme").id)
    }
}

