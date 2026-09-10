package org.switchboard.android

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.int
import kotlinx.serialization.json.intOrNull
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
import org.switchboard.android.irc.Casemap
import org.switchboard.android.irc.ConnectionState
import org.switchboard.android.irc.Irc
import org.switchboard.android.vault.VaultEnvelope
import org.switchboard.android.vault.VaultKdf
import org.switchboard.android.vault.VaultPayload
import org.switchboard.android.vault.shouldAdoptVault
import org.switchboard.android.irc.Formatting
import org.switchboard.android.irc.Friends
import org.switchboard.android.irc.Isupport
import org.switchboard.android.irc.ServerConfig
import org.switchboard.android.irc.Services
import org.switchboard.android.irc.LineLength
import org.switchboard.android.irc.IrcMessage
import org.switchboard.android.irc.Metadata
import org.switchboard.android.irc.Multiline
import org.switchboard.android.irc.Sasl
import org.switchboard.android.ui.DEFAULT_PALETTE
import org.switchboard.android.ui.PALETTES
import org.switchboard.android.ui.paletteFor
import org.switchboard.android.irc.IrcConnection
import org.switchboard.android.vault.VaultCrypto
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
    // ── draft/multiline ──────────────────────────────────────────────

    /**
     * The two clients had already drifted here: this one honoured
     * `draft/multiline-concat` and the desktop joined everything with a
     * newline, so the same message read differently depending which screen you
     * were looking at.
     */
    @Test
    fun `reads the same multiline limits the desktop reads`() {
        for (case in load("multiline.json")["limits"]!!.jsonArray) {
            val c = case.jsonObject
            val name = c["name"]!!.jsonPrimitive.content
            val limits = Multiline.limitsFrom(c["value"]!!.jsonPrimitive.content)

            assertEquals(name, c["maxBytes"]!!.jsonPrimitive.intOrNull, limits.maxBytes)
            assertEquals(name, c["maxLines"]!!.jsonPrimitive.intOrNull, limits.maxLines)
        }
    }

    @Test
    fun `splits a message into the same batches the desktop would`() {
        for (case in load("multiline.json")["splits"]!!.jsonArray) {
            val c = case.jsonObject
            val name = c["name"]!!.jsonPrimitive.content
            val lines = c["lines"]!!.jsonArray.map { it.jsonPrimitive.content }
            val expected = c["batches"]!!.jsonArray.map { batch ->
                batch.jsonArray.map { it.jsonPrimitive.content }
            }

            val limits = Multiline.limitsFrom(c["value"]!!.jsonPrimitive.content)
            assertEquals(name, expected, Multiline.split(lines, limits))
        }
    }

    @Test
    fun `puts a received multiline back together the way the desktop does`() {
        for (case in load("multiline.json")["concat"]!!.jsonArray) {
            val c = case.jsonObject
            val name = c["name"]!!.jsonPrimitive.content

            val parts = c["parts"]!!.jsonArray.map { part ->
                val p = part.jsonObject
                val concat = p["concat"]!!.jsonPrimitive.content == "true"
                IrcMessage(
                    tags = if (concat) mapOf("draft/multiline-concat" to "") else emptyMap(),
                    prefix = "robin!r@h",
                    command = "PRIVMSG",
                    params = listOf("#lounge", p["text"]!!.jsonPrimitive.content)
                )
            }

            assertEquals(name, c["text"]!!.jsonPrimitive.content, Multiline.combine(parts))
        }
    }

    // ── the values servers put on their capabilities ─────────────────

    /**
     * A capability is not only a yes. `sasl=PLAIN`,
     * `draft/metadata-2=max-value-bytes=4096` and
     * `draft/multiline=max-lines=20` each say what the server will actually
     * take, and ignoring them means sending something it has already said it
     * will refuse.
     */
    @Test
    fun `reads the same SASL mechanisms the desktop reads`() {
        for (case in load("cap-values.json")["sasl"]!!.jsonArray) {
            val c = case.jsonObject
            val name = c["name"]!!.jsonPrimitive.content
            val expected = (c["mechanisms"] as? JsonArray)?.map { it.jsonPrimitive.content }

            assertEquals(name, expected, Sasl.mechanismsFrom(c["value"]!!.jsonPrimitive.content))
        }
    }

    @Test
    fun `reads the same metadata limits the desktop reads`() {
        for (case in load("cap-values.json")["metadata"]!!.jsonArray) {
            val c = case.jsonObject
            val name = c["name"]!!.jsonPrimitive.content
            val limits = Metadata.limitsFrom(c["value"]!!.jsonPrimitive.content)

            assertEquals(name, c["maxSubs"]!!.jsonPrimitive.intOrNull, limits.maxSubs)
            assertEquals(name, c["maxKeys"]!!.jsonPrimitive.intOrNull, limits.maxKeys)
            assertEquals(name, c["maxValueBytes"]!!.jsonPrimitive.intOrNull, limits.maxValueBytes)
        }
    }

    @Test
    fun `agrees with the desktop on whether a profile field will be kept`() {
        for (case in load("cap-values.json")["fits"]!!.jsonArray) {
            val c = case.jsonObject
            val name = c["name"]!!.jsonPrimitive.content
            val limit = Metadata.limitsFrom(c["value"]!!.jsonPrimitive.content).maxValueBytes
            val text = c["text"]!!.jsonPrimitive.content

            val fits = limit == null || text.toByteArray(Charsets.UTF_8).size <= limit
            assertEquals(name, c["fits"]!!.jsonPrimitive.content == "true", fits)
        }
    }

    /**
     * Both clients render the same four states, and a screen that picks a
     * different one is a different client.
     */
    @Test
    fun `chooses the same account screen the desktop chooses`() {
        for (case in load("accounts.json")["views"]!!.jsonArray) {
            val c = case.jsonObject
            val chosen = accountView(
                connected = c["connected"]!!.jsonPrimitive.content == "true",
                account = (c["account"] as? JsonPrimitive)?.contentOrNull,
                remembered = c["remembered"]!!.jsonPrimitive.content == "true",
                canRegister = c["canRegister"]!!.jsonPrimitive.content == "true"
            )

            assertEquals(
                c["name"]!!.jsonPrimitive.content,
                c["view"]!!.jsonPrimitive.content,
                chosen.name.lowercase()
            )
        }
    }

    /**
     * Which of two sealed configs to keep.
     *
     * Both devices have to answer this identically or they trade vaults
     * forever, or worse, one quietly rolls the other back.
     */
    @Test
    fun `decides which config to keep the way the desktop decides`() {
        fun envelope(from: JsonObject?): VaultEnvelope? {
            if (from == null) return null
            return VaultEnvelope(
                format = 1,
                kdf = VaultKdf(name = "pbkdf2", iterations = 1, salt = ""),
                iv = "",
                ciphertext = "",
                tag = "",
                version = from["version"]!!.jsonPrimitive.int,
                updatedAt = (from["updatedAt"] as? JsonPrimitive)?.contentOrNull.orEmpty(),
                updatedBy = "test"
            )
        }

        for (case in load("vault-order.json")["cases"]!!.jsonArray) {
            val c = case.jsonObject
            val incoming = envelope(c["incoming"]!!.jsonObject)!!
            val current = envelope(c["current"] as? JsonObject)

            assertEquals(
                c["name"]!!.jsonPrimitive.content,
                c["adopt"]!!.jsonPrimitive.content == "true",
                shouldAdoptVault(incoming, current)
            )
        }
    }

    // ── knowing NickServ when you see it ─────────────────────────────

    /**
     * Both clients offer the login screen at the same moment, or they are two
     * clients. The lines are real ones, from the three services packages most
     * of IRC runs.
     */
    @Test
    fun `recognises the services bots the desktop recognises`() {
        for (case in load("services.json")["nicks"]!!.jsonArray) {
            val c = case.jsonObject
            assertEquals(
                c["name"]!!.jsonPrimitive.content,
                c["isServices"]!!.jsonPrimitive.content == "true",
                Services.isServices(c["nick"]!!.jsonPrimitive.content)
            )
        }
    }

    @Test
    fun `reads the same meaning out of what services said`() {
        for (case in load("services.json")["prompts"]!!.jsonArray) {
            val c = case.jsonObject
            val name = c["name"]!!.jsonPrimitive.content
            val text = c["text"]!!.jsonPrimitive.content

            assertEquals(
                name,
                c["asks"]!!.jsonPrimitive.content == "true",
                Services.asksForIdentification(text)
            )
            assertEquals(
                name,
                c["confirms"]!!.jsonPrimitive.content == "true",
                Services.confirmsIdentification(text)
            )
        }
    }

    // ── what a network can do about accounts ─────────────────────────

    /**
     * Both clients put the same form in front of the user — register here,
     * or talk to NickServ — so both have to reach the same conclusion from
     * the same capability values. Offering to register on a network that
     * will not is offering a dead end.
     */
    @Test
    fun `reads the account capabilities the way the desktop does`() {
        for (case in load("accounts.json")["cases"]!!.jsonArray) {
            val c = case.jsonObject
            val name = c["name"]!!.jsonPrimitive.content

            val values = c["values"]!!.jsonObject
                .mapValues { (_, v) -> v.jsonPrimitive.content }
            val abilities = accountAbilitiesOf(values)

            assertEquals(name, c["canRegister"]!!.jsonPrimitive.content == "true", abilities.canRegister)
            assertEquals(name, c["emailRequired"]!!.jsonPrimitive.content == "true", abilities.emailRequired)
            assertEquals(
                name,
                (c["minPasswordLength"] as? JsonPrimitive)?.contentOrNull?.toIntOrNull(),
                abilities.minPasswordLength
            )
            assertEquals(name, c["beforeConnect"]!!.jsonPrimitive.content == "true", abilities.beforeConnect)
            assertEquals(
                name,
                c["saslMechanisms"]!!.jsonArray.map { it.jsonPrimitive.content },
                abilities.saslMechanisms
            )
            assertEquals(
                name,
                (c["bestMechanism"] as? JsonPrimitive)?.contentOrNull,
                bestSaslMechanism(abilities.saslMechanisms)
            )
        }
    }

    /**
     * Whether both devices can be on one network at once.
     *
     * The precondition, not the permission: the network gives its answer by
     * letting the second connection keep the nick or not. A device that decides
     * this differently from the other either sits out a network it could have
     * joined, or turns up in the channel twice under two names.
     */
    @Test
    fun `agrees with the desktop about which networks can be shared`() {
        for (case in load("accounts.json")["sharing"]!!.jsonArray) {
            val c = case.jsonObject
            val config = c["config"]!!.jsonObject

            val server = ServerConfig(
                id = "s",
                name = "Test",
                host = "irc.example.org",
                nick = "kara",
                saslMechanism = (config["saslMechanism"] as? JsonPrimitive)?.contentOrNull,
                saslPassword = (config["saslPassword"] as? JsonPrimitive)?.contentOrNull,
                identifyCommand = (config["identifyCommand"] as? JsonPrimitive)?.contentOrNull
            )

            assertEquals(
                c["name"]!!.jsonPrimitive.content,
                c["canShare"]!!.jsonPrimitive.content == "true",
                canShareConnection(server)
            )
        }
    }

    // ── being named ──────────────────────────────────────────────────

    /**
     * Whether a line is about you.
     *
     * Three parts of each client ask this — the notifier, the unread badge and
     * the conversation highlight — and the two clients have to answer
     * identically. A mention that rings the phone and does not colour the
     * desktop is two clients, not one.
     */
    @Test
    fun `agrees with the desktop about who was named`() {
        for (case in load("mentions.json")["cases"]!!.jsonArray) {
            val c = case.jsonObject
            val name = c["name"]!!.jsonPrimitive.content

            assertEquals(
                name,
                c["mentions"]!!.jsonPrimitive.content == "true",
                namesYou(
                    c["text"]!!.jsonPrimitive.content,
                    c["nick"]!!.jsonPrimitive.content
                )
            )
        }
    }

    // ── casemapping ──────────────────────────────────────────────────

    /**
     * Which characters count as the same letter is the server's decision, and
     * both clients have to make it the same way — otherwise the same person
     * appears twice on one screen and once on the other.
     */
    @Test
    fun `folds names the way the desktop folds them`() {
        for (case in load("casemapping.json")["cases"]!!.jsonArray) {
            val c = case.jsonObject
            val name = c["name"]!!.jsonPrimitive.content
            val mapping = Casemap.mappingOf((c["value"] as? JsonPrimitive)?.contentOrNull)

            assertEquals(
                name,
                c["folded"]!!.jsonPrimitive.content,
                Casemap.fold(c["input"]!!.jsonPrimitive.content, mapping)
            )
        }
    }

    @Test
    fun `agrees with the desktop on which names are the same name`() {
        for (case in load("casemapping.json")["same"]!!.jsonArray) {
            val c = case.jsonObject
            val name = c["name"]!!.jsonPrimitive.content
            val mapping = Casemap.mappingOf((c["value"] as? JsonPrimitive)?.contentOrNull)

            val same = Casemap.fold(c["a"]!!.jsonPrimitive.content, mapping) ==
                Casemap.fold(c["b"]!!.jsonPrimitive.content, mapping)
            assertEquals(name, c["same"]!!.jsonPrimitive.content == "true", same)
        }
    }

    /** Folding correctly in a helper nobody calls is worth nothing */
    @Test
    fun `finds a person the server considers the same person`() {
        val state = ConnectionState("s1")
        val channel = state.channel("#dev[core]")
        channel.setUser("bob[away]") { it }

        assertNotNull(state.findChannel("#DEV{CORE}"))
        assertNotNull(channel.user("BOB{AWAY}"))
    }

    /** On an ascii server those really are two people, and must stay two */
    @Test
    fun `keeps names apart when the server says ascii`() {
        val state = ConnectionState("s1")
        state.isupport["CASEMAPPING"] = "ascii"

        val channel = state.channel("#dev[core]")
        channel.setUser("bob[away]") { it }

        assertNull(state.findChannel("#dev{core}"))
        assertNull(channel.user("bob{away}"))
        assertNotNull(channel.user("BOB[AWAY]"))
    }

    // ── the 512-byte line ────────────────────────────────────────────

    /**
     * Over the limit, rIRCd answers `417 :Input line was too long` and
     * delivers nothing — the same shape as the multiline limits, in the place
     * people hit it most often, which is pasting a paragraph.
     */
    @Test
    fun `works out the same line budget the desktop works out`() {
        for (case in load("multiline.json")["budget"]!!.jsonArray) {
            val c = case.jsonObject
            val name = c["name"]!!.jsonPrimitive.content
            val isupport = c["isupport"]!!.jsonObject
                .mapValues { (_, v) -> v.jsonPrimitive.content }

            assertEquals(
                name,
                c["budget"]!!.jsonPrimitive.int,
                LineLength.budget(
                    c["nick"]!!.jsonPrimitive.content,
                    (c["userHost"] as? JsonPrimitive)?.contentOrNull,
                    isupport,
                    c["command"]!!.jsonPrimitive.content,
                    c["target"]!!.jsonPrimitive.content
                )
            )
        }
    }

    @Test
    fun `cuts a long line the same way the desktop cuts it`() {
        for (case in load("multiline.json")["split"]!!.jsonArray) {
            val c = case.jsonObject
            val name = c["name"]!!.jsonPrimitive.content
            val expected = c["pieces"]!!.jsonArray.map { it.jsonPrimitive.content }

            assertEquals(
                name,
                expected,
                LineLength.split(c["text"]!!.jsonPrimitive.content, c["budget"]!!.jsonPrimitive.int)
            )
        }
    }

    // ── the numbers in ISUPPORT ──────────────────────────────────────

    /**
     * TARGMAX is the one that loses the message: `PRIVMSG:1`, and a message
     * addressed to two people comes back `407 :Too many recipients` —
     * delivered to neither, which is not what "too many" sounds like.
     */
    @Test
    fun `reads the same target limits the desktop reads`() {
        for (case in load("cap-values.json")["targmax"]!!.jsonArray) {
            val c = case.jsonObject
            val name = c["name"]!!.jsonPrimitive.content
            val value = (c["value"] as? JsonPrimitive)?.contentOrNull
            val isupport = if (value == null) emptyMap() else mapOf("TARGMAX" to value)

            assertEquals(
                name,
                (c["max"] as? JsonPrimitive)?.intOrNull,
                Isupport.targetMax(isupport, c["command"]!!.jsonPrimitive.content)
            )
        }
    }

    @Test
    fun `groups recipients the same way the desktop groups them`() {
        for (case in load("cap-values.json")["groups"]!!.jsonArray) {
            val c = case.jsonObject
            val name = c["name"]!!.jsonPrimitive.content
            val expected = c["groups"]!!.jsonArray.map { it.jsonPrimitive.content }

            assertEquals(
                name,
                expected,
                Isupport.groupTargets(
                    c["targets"]!!.jsonPrimitive.content,
                    (c["max"] as? JsonPrimitive)?.intOrNull
                )
            )
        }
    }

    /** Bytes, which is what the server counts, not characters */
    @Test
    fun `measures a stated length the way the desktop measures it`() {
        assertEquals(307, Isupport.number(mapOf("TOPICLEN" to "307"), "TOPICLEN"))
        assertNull(Isupport.number(mapOf("TOPICLEN" to "0"), "TOPICLEN"))
        assertNull(Isupport.number(mapOf("TOPICLEN" to "lots"), "TOPICLEN"))
        assertNull(Isupport.number(emptyMap(), "TOPICLEN"))

        assertTrue(Isupport.fits("abcdefghij", 10))
        assertFalse(Isupport.fits("abcdefghijk", 10))
        assertTrue(Isupport.fits("日本語", 10))
        assertFalse(Isupport.fits("日本語です", 10))
        assertTrue(Isupport.fits("anything at all", null))
    }

    // ── what the vault carries besides servers ───────────────────────

    /**
     * Servers were the only shared thing for a long time, so a theme picked
     * here and a friend added on the desktop each stayed where they were made
     * — on two clients that are meant to be one client in two places.
     */
    @Test
    fun `reads the shared state the desktop seals`() {
        val fixture = load("vault-shared-state.json")
        val payload = json.decodeFromJsonElement(
            VaultPayload.serializer(),
            fixture["payload"]!!
        )
        val expected = fixture["expected"]!!.jsonObject

        assertEquals(
            expected["theme"]!!.jsonPrimitive.content,
            (payload.settings["theme"] as? JsonPrimitive)?.content
        )

        val watched = expected["watched"]!!.jsonObject
        for ((serverId, nicks) in watched) {
            assertEquals(
                "watched nicks for $serverId",
                nicks.jsonArray.map { it.jsonPrimitive.content },
                payload.monitor[serverId]
            )
        }

        assertEquals(
            expected["serverIds"]!!.jsonArray.map { it.jsonPrimitive.content },
            payload.servers.map { it.id }
        )

        // A display name and a set of pronouns are facts about the person, not
        // about the machine they were typed on. This phone writes it; a desktop
        // that did not know about it dropped it on the next reseal.
        val profile = expected["profile"]!!.jsonObject
        val sealed = payload.settings["profile"]!!.jsonObject
        for ((key, value) in profile) {
            assertEquals("profile.$key", value.jsonPrimitive.content, sealed[key]?.jsonPrimitive?.content)
        }

        // Joining a channel is how you say you want to be in it, and there is
        // no other signal — so the join is the setting, and it belongs to the
        // config both clients read rather than to one device's local list.
        val autoJoin = expected["autoJoin"]!!.jsonObject
        for (server in payload.servers) {
            assertEquals(
                "join-on-connect for ${server.id}",
                autoJoin[server.id]!!.jsonArray.map { it.jsonPrimitive.content },
                server.autoJoin
            )
        }
    }

    /**
     * Upgrading one device must not lock the other out of its own config, in
     * either direction.
     */
    @Test
    fun `opens a vault sealed before any of this existed`() {
        val payload = json.decodeFromJsonElement(
            VaultPayload.serializer(),
            load("vault-shared-state.json")["older"]!!
        )

        assertEquals(1, payload.servers.size)
        assertTrue("missing fields read as empty, not as an error", payload.settings.isEmpty())
        assertTrue(payload.monitor.isEmpty())
    }

    @Test
    fun `opens a vault from a client that knows something we do not`() {
        val payload = json.decodeFromJsonElement(
            VaultPayload.serializer(),
            load("vault-shared-state.json")["newer"]!!
        )

        assertEquals("gruvbox", (payload.settings["theme"] as? JsonPrimitive)?.content)
        assertTrue(payload.servers.isEmpty())
    }

    // ── mIRC formatting ───────────────────────────────────────────────

    @Test
    fun `draws every formatting case the way the desktop draws it`() {
        val corpus = load("formatting.json")
        val cases = corpus["cases"]!!.jsonArray
        assertTrue("corpus should not be empty", cases.size > 20)

        for (entry in cases) {
            val case = entry.jsonObject
            val name = case["name"]!!.jsonPrimitive.content
            val text = case["text"]!!.jsonPrimitive.content
            val spans = Formatting.parse(text)
            val expected = case["spans"]!!.jsonArray

            assertEquals("$name: span count", expected.size, spans.size)
            for ((i, want) in expected.withIndex()) {
                val w = want.jsonObject
                val got = spans[i]
                fun flag(key: String) = w[key]?.jsonPrimitive?.booleanOrNull ?: false
                fun colour(key: String) = w[key]?.jsonPrimitive?.contentOrNull

                assertEquals("$name: span $i text", w["text"]!!.jsonPrimitive.content, got.text)
                assertEquals("$name: span $i bold", flag("bold"), got.bold)
                assertEquals("$name: span $i italic", flag("italic"), got.italic)
                assertEquals("$name: span $i underline", flag("underline"), got.underline)
                assertEquals("$name: span $i strikethrough", flag("strikethrough"), got.strikethrough)
                assertEquals("$name: span $i monospace", flag("monospace"), got.monospace)
                assertEquals("$name: span $i reverse", flag("reverse"), got.reverse)
                assertEquals("$name: span $i fg", colour("fg"), got.fg)
                assertEquals("$name: span $i bg", colour("bg"), got.bg)
            }

            val plain = case["plain"]!!.jsonPrimitive.content
            assertEquals("$name: stripped", plain, Formatting.strip(text))

            // Everything that measures into a message — links, mention
            // highlights — measures into the stripped text, so the spans have
            // to add up to it exactly. This is the invariant the phone broke:
            // link ranges were taken from the wire form and landed early.
            assertEquals(
                "$name: spans add up to what the reader sees",
                plain,
                spans.joinToString("") { it.text }
            )
        }
    }

    @Test
    fun `lifts the colours that would vanish into a dark window`() {
        for (entry in load("formatting.json")["readable"]!!.jsonArray) {
            val case = entry.jsonObject
            assertEquals(
                case["name"]!!.jsonPrimitive.content,
                case["out"]!!.jsonPrimitive.contentOrNull,
                Formatting.readableOnDark(
                    case["fg"]!!.jsonPrimitive.contentOrNull,
                    case["bg"]!!.jsonPrimitive.contentOrNull
                )
            )
        }
    }

    @Test
    fun `knows the whole palette`() {
        assertEquals(99, Formatting.PALETTE.size)
        assertEquals("#ffffff", Formatting.PALETTE[0])
        assertEquals("#d2d2d2", Formatting.PALETTE[15])
        assertEquals("#ffffff", Formatting.PALETTE[98])
        assertNull("99 means the client's own colour", Formatting.paletteColour(99))
    }

    // ── the friend list ───────────────────────────────────────────────

    @Test
    fun `speaks whichever watch command the network takes`() {
        val corpus = load("friends.json")

        for (entry in corpus["kinds"]!!.jsonArray) {
            val case = entry.jsonObject
            val name = case["name"]!!.jsonPrimitive.content
            val isupport = case["isupport"]!!.jsonObject.mapValues { (_, v) ->
                v.jsonPrimitive.contentOrNull ?: ""
            }
            val expected = case["kind"]!!.jsonPrimitive.contentOrNull
            assertEquals("$name: kind", expected, Friends.kind(isupport)?.name)
            assertEquals(
                "$name: limit",
                case["limit"]!!.jsonPrimitive.intOrNull,
                Friends.limit(isupport)
            )
        }

        for (entry in corpus["lines"]!!.jsonArray) {
            val case = entry.jsonObject
            val name = case["name"]!!.jsonPrimitive.content
            val kind = Friends.Kind.valueOf(case["kind"]!!.jsonPrimitive.content)
            val nicks = case["nicks"]!!.jsonArray.map { it.jsonPrimitive.content }
            val add = case["action"]!!.jsonPrimitive.content == "add"
            val expected = case["lines"]!!.jsonArray.map { it.jsonPrimitive.content }
            assertEquals(name, expected, Friends.lines(kind, nicks, add))
        }

        for (entry in corpus["status"]!!.jsonArray) {
            val case = entry.jsonObject
            val kind = Friends.Kind.valueOf(case["kind"]!!.jsonPrimitive.content)
            assertEquals(case["here"]!!.jsonPrimitive.content, Friends.statusLine(kind))
            assertEquals(case["list"]!!.jsonPrimitive.content, Friends.listLine(kind))
        }
    }

    @Test
    fun `keeps a long friend list inside one line each and loses nobody`() {
        val many = (0 until 200).map { "someverylongnickname$it" }
        for (kind in Friends.Kind.entries) {
            for (line in Friends.lines(kind, many, add = true)) {
                assertTrue(
                    "a watch line has to fit in one IRC message",
                    line.toByteArray().size + 2 < 512
                )
            }
        }
        val sent = Friends.lines(Friends.Kind.WATCH, many, add = true)
            .flatMap { it.removePrefix("WATCH ").split(" ") }
            .map { it.removePrefix("+") }
        assertEquals(many, sent)
    }

    // ── who a line came from ──────────────────────────────────────────

    @Test
    fun `tells a server apart from a person`() {
        for (entry in load("source.json")["cases"]!!.jsonArray) {
            val case = entry.jsonObject
            assertEquals(
                case["name"]!!.jsonPrimitive.content,
                case["server"]!!.jsonPrimitive.boolean,
                Irc.isServerSource(case["prefix"]!!.jsonPrimitive.contentOrNull)
            )
        }
    }

    @Test
    fun `files a message to part of a channel under the channel`() {
        for (entry in load("statusmsg.json")["cases"]!!.jsonArray) {
            val case = entry.jsonObject
            val name = case["name"]!!.jsonPrimitive.content
            val got = Isupport.statusTarget(
                case["target"]!!.jsonPrimitive.content,
                case["statusmsg"]!!.jsonPrimitive.contentOrNull
            )
            assertEquals("$name: channel", case["channel"]!!.jsonPrimitive.content, got.target)
            assertEquals("$name: status", case["status"]!!.jsonPrimitive.contentOrNull, got.status)
        }
    }

}
