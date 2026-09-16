package org.switchboard.android

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
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
import kotlinx.serialization.json.long
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.switchboard.android.irc.Aliases
import org.switchboard.android.irc.AutoAway
import org.switchboard.android.irc.ChanModes
import org.switchboard.android.irc.Casemap
import org.switchboard.android.irc.ConnectionError
import org.switchboard.android.irc.ConnectionState
import org.switchboard.android.irc.Dcc
import org.switchboard.android.irc.Formatter
import org.switchboard.android.irc.Ignore
import org.switchboard.android.irc.Irc
import org.switchboard.android.irc.Socks
import org.switchboard.android.irc.Transcript
import org.switchboard.android.vault.VaultEnvelope
import org.switchboard.android.vault.VaultKdf
import org.switchboard.android.vault.VaultPayload
import org.switchboard.android.vault.shouldAdoptVault
import org.switchboard.android.irc.ClientTags
import org.switchboard.android.irc.Completion
import org.switchboard.android.irc.Decoding
import org.switchboard.android.irc.CapNames
import org.switchboard.android.irc.Ctcp
import org.switchboard.android.irc.CtcpGuard
import org.switchboard.android.irc.NotOnChannel
import org.switchboard.android.irc.Holding
import org.switchboard.android.irc.Filehost
import org.switchboard.android.irc.dialChanged
import org.switchboard.android.irc.Formatting
import org.switchboard.android.irc.avatarUrl
import org.switchboard.android.irc.Friends
import org.switchboard.android.irc.History
import org.switchboard.android.irc.Isupport
import org.switchboard.android.irc.Jump
import org.switchboard.android.irc.Links
import org.switchboard.android.irc.Klipy
import org.switchboard.android.irc.Events
import org.switchboard.android.irc.Emoji
import org.switchboard.android.irc.Nicks
import org.switchboard.android.irc.IrcUrl
import org.switchboard.android.irc.TrustedCertificate
import org.switchboard.android.irc.Addresses
import org.switchboard.android.irc.Bouncer
import org.switchboard.android.irc.NetworkId
import org.switchboard.android.irc.ServerConfig
import org.switchboard.android.irc.Reconnect
import org.switchboard.android.irc.Powers
import org.switchboard.android.irc.PrivateAddress
import org.switchboard.android.irc.Profile
import org.switchboard.android.irc.Redact
import org.switchboard.android.irc.Unread
import org.switchboard.android.irc.ServerTime
import org.switchboard.android.irc.Search
import org.switchboard.android.irc.Services
import org.switchboard.android.irc.Typing
import org.switchboard.android.irc.LineLength
import org.switchboard.android.irc.IrcMessage
import org.switchboard.android.irc.Metadata
import org.switchboard.android.irc.MaskLists
import org.switchboard.android.irc.Multiline
import org.switchboard.android.irc.Sasl
import org.switchboard.android.irc.SaslPlan
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

            val placeholder =
                (c["currentIsPlaceholder"] as? JsonPrimitive)?.content == "true"

            assertEquals(
                c["name"]!!.jsonPrimitive.content,
                c["adopt"]!!.jsonPrimitive.content == "true",
                shouldAdoptVault(incoming, current, placeholder)
            )
        }
    }

    // ── saying somebody is typing ────────────────────────────────────

    /**
     * The phone ran this on a timer and the desktop ran it on keystrokes, so a
     * message typed in one go cost three `active` notices from one client and
     * one from the other — and the phone said `done` twice at the end. All of
     * it was visible on the wire the first time anyone watched a send from
     * outside both clients.
     */
    @Test
    fun `says somebody is typing when the desktop would`() {
        for (case in load("typing.json")["cases"]!!.jsonArray) {
            val c = case.jsonObject
            val event = when (c["event"]!!.jsonPrimitive.content) {
                "typed" -> Typing.Event.TYPED
                "cleared" -> Typing.Event.CLEARED
                else -> Typing.Event.SENT
            }

            val decision = Typing.toSend(
                event,
                c["lastActiveAt"]!!.jsonPrimitive.long,
                c["now"]!!.jsonPrimitive.long
            )

            val name = c["name"]!!.jsonPrimitive.content
            assertEquals(name, (c["send"] as? JsonPrimitive)?.contentOrNull, decision.send)
            assertEquals(
                name,
                c["nextLastActiveAt"]!!.jsonPrimitive.long,
                decision.lastActiveAt
            )
        }
    }

    /** The throttle the corpus was written against is the one in force */
    @Test
    fun `holds the typing rate the corpus assumes`() {
        assertEquals(
            load("typing.json")["throttleMs"]!!.jsonPrimitive.long,
            Typing.THROTTLE_MS
        )
    }

    // ── coming back to a server that closed on us ────────────────────

    /**
     * The ladder was never the problem: both clients had one and neither ever
     * climbed it, because both reset the attempt counter when the socket
     * opened rather than when the server accepted them. A connect throttle
     * accepts the connection and closes it, so the counter went back to zero
     * every time and the client redialled every two seconds indefinitely.
     */
    @Test
    fun `waits as long as the desktop waits before dialling again`() {
        val corpus = load("reconnect.json")

        assertEquals(corpus["baseMs"]!!.jsonPrimitive.long, Reconnect.BASE_MS)
        assertEquals(corpus["maxMs"]!!.jsonPrimitive.long, Reconnect.MAX_MS)
        assertEquals(
            corpus["throttledFloorMs"]!!.jsonPrimitive.long,
            Reconnect.THROTTLED_FLOOR_MS
        )

        for (case in corpus["slowDown"]!!.jsonArray) {
            val c = case.jsonObject
            assertEquals(
                c["name"]!!.jsonPrimitive.content,
                c["slowDown"]!!.jsonPrimitive.content == "true",
                Reconnect.saysSlowDown(c["text"]!!.jsonPrimitive.content)
            )
        }

        for (case in corpus["delays"]!!.jsonArray) {
            val c = case.jsonObject
            assertEquals(
                c["name"]!!.jsonPrimitive.content,
                c["delayMs"]!!.jsonPrimitive.long,
                Reconnect.delay(
                    c["attempt"]!!.jsonPrimitive.int,
                    (c["lastError"] as? JsonPrimitive)?.contentOrNull
                )
            )
        }
    }

    /** Nothing said is not a reason to wait longer */
    @Test
    fun `says nothing about a message that is not there`() {
        assertEquals(false, Reconnect.saysSlowDown(null))
        assertEquals(Reconnect.BASE_MS, Reconnect.delay(1, null))
    }

    // ── taking the secret out of a line ──────────────────

    /**
     * Every line the desktop sent was emitted on a debug stream, and that
     * stream was handed to every paired device, carrying the credentials
     * `sanitizeForRemote` strips out of the config before it travels. Both
     * clients hold to the same idea of what a secret is.
     */
    @Test
    fun `hides the same secrets the desktop hides`() {
        for (case in load("redact.json")["cases"]!!.jsonArray) {
            val c = case.jsonObject
            assertEquals(
                c["name"]!!.jsonPrimitive.content,
                c["redacted"]!!.jsonPrimitive.content,
                Redact.line(c["line"]!!.jsonPrimitive.content)
            )
        }
    }

    // ── grey, white, or a number ─────────────────────────────────────

    /**
     * Three states and nothing else, because a sidebar is read at a glance.
     * This phone put a grey count on every unread channel, so "something was
     * said" and "you were named" were both numbers; it counted direct messages
     * toward the network badge, which double-counts them now that people have
     * their own button; and it ignored muting entirely.
     */
    @Test
    fun `counts an arriving line toward a badge the way the desktop does`() {
        for (case in load("unread.json")["counts"]!!.jsonArray) {
            val c = case.jsonObject
            fun text(key: String) = c[key]!!.jsonPrimitive.contentOrNull
            fun flag(key: String) = c[key]!!.jsonPrimitive.boolean

            assertEquals(
                c["name"]!!.jsonPrimitive.content,
                flag("counts"),
                Unread.countsAsUnread(
                    timestamp = text("timestamp"),
                    readTo = text("readTo"),
                    onScreen = flag("onScreen"),
                    mine = flag("mine")
                )
            )
        }
    }

    @Test
    fun `reads unread the way the desktop reads it`() {
        val corpus = load("unread.json")

        for (case in corpus["rows"]!!.jsonArray) {
            val c = case.jsonObject
            val name = c["name"]!!.jsonPrimitive.content
            val look = Unread.rowLook(
                c["unread"]!!.jsonPrimitive.int,
                c["muted"]!!.jsonPrimitive.content == "true",
                c["selected"]!!.jsonPrimitive.content == "true"
            )
            assertEquals(name, c["look"]!!.jsonPrimitive.content, look.name.lowercase())

            val badge = Unread.rowBadge(
                c["mentions"]!!.jsonPrimitive.int,
                c["muted"]!!.jsonPrimitive.content == "true"
            )
            val expected = c["badge"] as? JsonObject
            if (expected == null) {
                assertEquals(name, null, badge)
            } else {
                assertEquals(name, expected["count"]!!.jsonPrimitive.int, badge?.count)
                assertEquals(
                    name,
                    expected["muted"]!!.jsonPrimitive.content == "true",
                    badge?.muted
                )
            }
        }

        for (case in corpus["badges"]!!.jsonArray) {
            val c = case.jsonObject
            val name = c["name"]!!.jsonPrimitive.content
            val count = c["count"]!!.jsonPrimitive.int
            assertEquals(name, c["label"]!!.jsonPrimitive.content, Unread.badgeLabel(count))
            assertEquals(name, c["diameter"]!!.jsonPrimitive.int, Unread.badgeDiameter(count))
        }

        for (case in corpus["rails"]!!.jsonArray) {
            val c = case.jsonObject
            val name = c["name"]!!.jsonPrimitive.content
            val conversations = c["conversations"]!!.jsonArray.map { entry ->
                val o = entry.jsonObject
                Unread.Conversation(
                    name = o["name"]!!.jsonPrimitive.content,
                    unread = o["unread"]!!.jsonPrimitive.int,
                    mentions = o["mentions"]!!.jsonPrimitive.int,
                    muted = o["muted"]!!.jsonPrimitive.content == "true"
                )
            }

            val look = Unread.railLook(
                conversations,
                active = c["active"]!!.jsonPrimitive.content == "true",
                serverMuted = c["serverMuted"]!!.jsonPrimitive.content == "true"
            )

            assertEquals(name, c["chip"]!!.jsonPrimitive.content, look.chip.name.lowercase())
            assertEquals(name, c["mentions"]!!.jsonPrimitive.int, look.mentions)
            assertEquals(
                name,
                c["mentionsMuted"]!!.jsonPrimitive.content == "true",
                look.mentionsMuted
            )
        }
    }

    // ── what you may do to somebody ──────────────────────────────────

    /**
     * There is no IRCv3 specification for this, so both clients infer it the
     * same way or they offer different menus for the same channel. Both
     * showed Kick to everybody before this and let the server answer 482.
     */
    @Test
    fun `offers the actions the desktop offers`() {
        for (case in load("powers.json")["cases"]!!.jsonArray) {
            val c = case.jsonObject
            val actions = Powers.actionsFor(
                prefix = c["prefix"]!!.jsonPrimitive.content,
                chanmodes = c["chanmodes"]!!.jsonPrimitive.content,
                mine = c["mine"]!!.jsonPrimitive.content,
                theirs = c["theirs"]!!.jsonPrimitive.content,
                isSelf = c["isSelf"]!!.jsonPrimitive.content == "true",
                ignored = (c["ignored"] as? JsonPrimitive)?.content == "true"
            )
            assertEquals(
                c["name"]!!.jsonPrimitive.content,
                c["actions"]!!.jsonArray.map { it.jsonPrimitive.content },
                actions.map { it.name.lowercase() }
            )
        }
    }

    /** Which group a member belongs in, and what the desktop calls it */
    @Test
    fun `groups members the way the desktop groups them`() {
        for (case in load("powers.json")["roles"]!!.jsonArray) {
            val c = case.jsonObject
            val role = Powers.roleOf(
                c["prefixes"]!!.jsonArray.map { it.jsonPrimitive.content },
                (c["prefix"] as? JsonPrimitive)?.contentOrNull
            )
            val name = c["name"]!!.jsonPrimitive.content

            assertEquals(name, c["rank"]!!.jsonPrimitive.int, role.rank)
            assertEquals(name, c["label"]!!.jsonPrimitive.content, role.label)
        }
    }

    /** The mask a ban names, which is the host wherever the network gave one */
    @Test
    fun `bans what the desktop bans`() {
        for (case in load("powers.json")["masks"]!!.jsonArray) {
            val c = case.jsonObject
            val host = (c["host"] as? JsonPrimitive)?.contentOrNull
            assertEquals(
                c["name"]!!.jsonPrimitive.content,
                c["mask"]!!.jsonPrimitive.content,
                Powers.banMask(c["nick"]!!.jsonPrimitive.content, host)
            )
            assertEquals(
                c["name"]!!.jsonPrimitive.content,
                c["weak"]!!.jsonPrimitive.content == "true",
                Powers.maskIsWeak(host)
            )
        }
    }

    // ── one profile for you, and a different one where you want it ───

    /**
     * A network with nothing of its own follows your profile; one with a
     * profile of its own overrides it field by field. Before this, adding a
     * network copied the global into it and editing anywhere wrote both, so
     * changing your name updated whichever network you were looking at and
     * left the rest frozen.
     */
    @Test
    fun `resolves a profile the way the desktop resolves it`() {
        val corpus = load("profile.json")

        fun mapOfOrNull(e: JsonElement?): Map<String, String>? =
            (e as? JsonObject)?.mapValues { it.value.jsonPrimitive.content }

        for (case in corpus["resolve"]!!.jsonArray) {
            val c = case.jsonObject
            assertEquals(
                c["name"]!!.jsonPrimitive.content,
                mapOfOrNull(c["result"]),
                Profile.resolve(mapOfOrNull(c["global"]), mapOfOrNull(c["override"]))
            )
        }

        for (case in corpus["override"]!!.jsonArray) {
            val c = case.jsonObject
            assertEquals(
                c["name"]!!.jsonPrimitive.content,
                mapOfOrNull(c["stored"]),
                Profile.overrideFrom(mapOfOrNull(c["global"]), mapOfOrNull(c["typed"]))
            )
        }

        for (case in corpus["same"]!!.jsonArray) {
            val c = case.jsonObject
            assertEquals(
                c["name"]!!.jsonPrimitive.content,
                c["same"]!!.jsonPrimitive.content == "true",
                Profile.same(mapOfOrNull(c["a"]), mapOfOrNull(c["b"]))
            )
        }

        // Clearing a field has to be published, or the network goes on wearing
        // the old one — on a server that keeps metadata between sessions, for
        // good. Both clients have to agree on which fields those are, and on
        // leaving alone the ones the network set on us itself.
        for (case in corpus["clear"]!!.jsonArray) {
            val c = case.jsonObject
            assertEquals(
                c["name"]!!.jsonPrimitive.content,
                c["result"]!!.jsonArray.map { it.jsonPrimitive.content },
                Profile.keysToClear(
                    c["keys"]!!.jsonArray.map { it.jsonPrimitive.content },
                    mapOfOrNull(c["published"]),
                    mapOfOrNull(c["next"])
                )
            )
        }
    }

    // ── DCC, where the address is an integer ─────────────────────────

    /**
     * A wrong address is not a failed transfer — it is a connection somewhere
     * else entirely. Both clients have to read and write that number the same
     * way, and the high bit is where a naive implementation goes wrong.
     */
    @Test
    fun `reads and writes DCC the way the desktop does`() {
        val corpus = load("dcc.json")

        fun offerOf(e: JsonElement): Dcc.Offer {
            val o = e.jsonObject
            return Dcc.Offer(
                kind = o["kind"]!!.jsonPrimitive.content,
                filename = o["filename"]!!.jsonPrimitive.content,
                address = o["address"]!!.jsonPrimitive.content,
                port = o["port"]!!.jsonPrimitive.content.toInt(),
                size = o["size"]!!.jsonPrimitive.content.toLong(),
                token = o["token"]?.jsonPrimitive?.content
            )
        }

        for (case in corpus["parse"]!!.jsonArray) {
            val c = case.jsonObject
            val name = c["name"]!!.jsonPrimitive.content
            val got = Dcc.parse(c["body"]!!.jsonPrimitive.content)

            if (c["offer"]!! is JsonNull) {
                assertEquals(name, null, got)
                continue
            }
            val wanted = offerOf(c["offer"]!!)
            assertEquals(name, wanted.kind, got?.kind)
            assertEquals(name, wanted.filename, got?.filename)
            assertEquals(name, wanted.address, got?.address)
            assertEquals(name, wanted.port, got?.port)
            assertEquals(name, wanted.size, got?.size)
            if (wanted.token != null) assertEquals(name, wanted.token, got?.token)
        }

        for (case in corpus["format"]!!.jsonArray) {
            val c = case.jsonObject
            assertEquals(
                c["name"]!!.jsonPrimitive.content,
                c["line"]!!.jsonPrimitive.content,
                Dcc.format(offerOf(c["offer"]!!))
            )
        }

        for (case in corpus["names"]!!.jsonArray) {
            val c = case.jsonObject
            assertEquals(
                c["name"]!!.jsonPrimitive.content,
                c["safe"]!!.jsonPrimitive.content,
                Dcc.safeFilename(c["offered"]!!.jsonPrimitive.content)
            )
        }
    }

    // ── a conversation as text ───────────────────────────────────────

    /**
     * A log written on one device and one written on the other have to be the
     * same file. Anything else is two formats, and the second one is the one
     * somebody's tooling does not read.
     */
    @Test
    fun `writes the transcript the desktop writes`() {
        val corpus = load("transcript.json")

        for (case in corpus["lines"]!!.jsonArray) {
            val c = case.jsonObject
            val m = c["message"]!!.jsonObject
            assertEquals(
                c["name"]!!.jsonPrimitive.content,
                c["line"]!!.jsonPrimitive.content,
                Transcript.line(
                    Transcript.Line(
                        nick = m["nick"]!!.jsonPrimitive.content,
                        content = m["content"]!!.jsonPrimitive.content,
                        timestamp = m["timestamp"]!!.jsonPrimitive.content,
                        type = m["type"]!!.jsonPrimitive.content
                    ),
                    keepFormatting = c["keepFormatting"]?.jsonPrimitive?.content == "true"
                )
            )
        }

        for (case in corpus["files"]!!.jsonArray) {
            val c = case.jsonObject
            assertEquals(
                c["name"]!!.jsonPrimitive.content,
                c["file"]!!.jsonPrimitive.content,
                Transcript.filename(
                    c["network"]!!.jsonPrimitive.content,
                    c["channel"]!!.jsonPrimitive.content
                )
            )
        }
    }

    /**
     * Who may change a channel, which both panels ask and neither should
     * answer for itself. It was answered by hand twice and backwards both
     * times — `rankOf` returns 0 for the most privileged.
     */
    @Test
    fun `agrees with the desktop about who may change a channel`() {
        val schemes = listOf("(ohv)@%+", "(qaohv)~&@%+", "(ov)@+")

        for (prefix in schemes) {
            // Operator and above, always
            for (mine in listOf("@", "&", "~").filter { prefix.contains(it) }) {
                assertEquals("$prefix / $mine", true, Powers.canModerate(prefix, mine))
            }
            // Half-operator where the network has one
            if (prefix.contains('%')) {
                assertEquals("$prefix / %", true, Powers.canModerate(prefix, "%"))
            }
            // Voice is not moderation, and neither is nothing
            assertEquals("$prefix / +", false, Powers.canModerate(prefix, "+"))
            assertEquals("$prefix / none", false, Powers.canModerate(prefix, ""))

            // And it draws the same line the member menu does
            for (mine in listOf("", "+", "%", "@", "&", "~")) {
                assertEquals(
                    "$prefix / $mine agrees with the menu",
                    Powers.actionsFor(prefix, "beI,k,l,imnst", mine, "", false)
                        .contains(Powers.Action.KICK),
                    Powers.canModerate(prefix, mine)
                )
            }
        }
    }

    // ── what a channel is set to ─────────────────────────────────────

    /**
     * Which letters a network has is its own answer; what they mean is
     * convention. Both clients have to agree on both, or a checkbox at the desk
     * sets something different from the one in your pocket.
     */
    @Test
    fun `reads channel settings the way the desktop reads them`() {
        val corpus = load("chanmodes.json")

        fun kindOf(name: String) = when (name) {
            "param" -> ChanModes.Kind.PARAM
            "paramOnSet" -> ChanModes.Kind.PARAM_ON_SET
            else -> ChanModes.Kind.FLAG
        }

        for (case in corpus["modes"]!!.jsonArray) {
            val c = case.jsonObject
            val name = c["name"]!!.jsonPrimitive.content
            val chanmodes = c["chanmodes"]!!.let { if (it is JsonNull) null else it.jsonPrimitive.content }
            val modes = ChanModes.settingsFor(chanmodes, c["prefix"]!!.jsonPrimitive.content)

            c["letters"]?.let { wanted ->
                assertEquals(
                    name,
                    wanted.jsonArray.map { it.jsonPrimitive.content },
                    modes.map { it.letter }
                )
            }
            c["kinds"]?.let { wanted ->
                assertEquals(
                    name,
                    wanted.jsonArray.map { kindOf(it.jsonPrimitive.content) },
                    modes.map { it.kind }
                )
            }
            c["excludes"]?.jsonArray?.forEach { letter ->
                assertEquals(
                    "$name — ${letter.jsonPrimitive.content} is not a setting",
                    false,
                    modes.any { it.letter == letter.jsonPrimitive.content }
                )
            }
        }

        for (case in corpus["labels"]!!.jsonArray) {
            val c = case.jsonObject
            val mode = ChanModes.settingsFor(
                c["chanmodes"]!!.jsonPrimitive.content,
                c["prefix"]!!.jsonPrimitive.content
            ).firstOrNull { it.letter == c["letter"]!!.jsonPrimitive.content }
            assertEquals(
                c["name"]!!.jsonPrimitive.content,
                c["label"]!!.jsonPrimitive.content,
                mode?.label
            )
        }

        for (case in corpus["changes"]!!.jsonArray) {
            val c = case.jsonObject
            val mode = ChanModes.Mode(
                c["letter"]!!.jsonPrimitive.content,
                kindOf(c["kind"]!!.jsonPrimitive.content),
                "x", "y"
            )
            val value = c["value"]!!.let { if (it is JsonNull) null else it.jsonPrimitive.content }
            val wanted = c["args"]!!.let {
                if (it is JsonNull) null else it.jsonArray.map { arg -> arg.jsonPrimitive.content }
            }
            assertEquals(
                c["name"]!!.jsonPrimitive.content,
                wanted,
                ChanModes.change(mode, c["on"]!!.jsonPrimitive.content == "true", value)
            )
        }
    }

    // ── commands you make up yourself ────────────────────────────────

    /**
     * An alias that means one thing at the desk and another in your pocket is
     * two clients — and the depth limit in particular has to match, because
     * without it one of them hangs on a line the other refuses.
     */
    @Test
    fun `expands aliases the way the desktop expands them`() {
        val corpus = load("aliases.json")
        val aliases = corpus["aliases"]!!.jsonArray.map {
            val o = it.jsonObject
            Aliases.Alias(
                o["name"]!!.jsonPrimitive.content,
                o["expansion"]!!.jsonPrimitive.content
            )
        }

        for (case in corpus["cases"]!!.jsonArray) {
            val c = case.jsonObject
            val name = c["name"]!!.jsonPrimitive.content
            val out = Aliases.expand(c["input"]!!.jsonPrimitive.content, aliases)

            val error = c["error"]?.jsonPrimitive?.content
            if (error != null) {
                assertEquals(name, error, out.error)
                assertEquals(name, emptyList<String>(), out.lines)
            } else {
                assertEquals(name, null, out.error)
                assertEquals(
                    name,
                    c["lines"]!!.jsonArray.map { it.jsonPrimitive.content },
                    out.lines
                )
            }
        }

        for (case in corpus["perform"]!!.jsonArray) {
            val c = case.jsonObject
            assertEquals(
                c["name"]!!.jsonPrimitive.content,
                c["lines"]!!.jsonArray.map { it.jsonPrimitive.content },
                Aliases.performLines(c["script"]!!.jsonPrimitive.content)
            )
        }
    }

    // ── writing formatting, not only reading it ──────────────────────

    /**
     * Bold typed on the phone and bold typed at the desk have to be the same
     * bytes, or one client's message renders wrong in the other's window.
     */
    @Test
    fun `writes the formatting the desktop writes`() {
        val corpus = load("formatting.json")

        for (case in corpus["writing"]!!.jsonArray) {
            val c = case.jsonObject
            val name = c["name"]!!.jsonPrimitive.content
            val out = Formatter.mark(
                c["text"]!!.jsonPrimitive.content,
                c["start"]!!.jsonPrimitive.content.toInt(),
                c["end"]!!.jsonPrimitive.content.toInt(),
                c["mark"]!!.jsonPrimitive.content
            )
            assertEquals(name, c["result"]!!.jsonPrimitive.content, out.text)
            assertEquals(name, c["selectionStart"]!!.jsonPrimitive.content.toInt(), out.selectionStart)
            assertEquals(name, c["selectionEnd"]!!.jsonPrimitive.content.toInt(), out.selectionEnd)
        }

        for (case in corpus["colour"]!!.jsonArray) {
            val c = case.jsonObject
            val fg = c["fg"]!!.let { if (it is JsonNull) null else it.jsonPrimitive.content.toInt() }
            val bg = c["bg"]!!.let { if (it is JsonNull) null else it.jsonPrimitive.content.toInt() }
            assertEquals(
                c["name"]!!.jsonPrimitive.content,
                c["result"]!!.jsonPrimitive.content,
                Formatter.colourise(
                    c["text"]!!.jsonPrimitive.content,
                    c["start"]!!.jsonPrimitive.content.toInt(),
                    c["end"]!!.jsonPrimitive.content.toInt(),
                    fg,
                    bg
                ).text
            )
        }
    }

    // ── people you would rather not hear from ────────────────────────

    /**
     * An ignore list that means different things on two devices is worse than
     * none: you would silence somebody at the desk and be messaged by them in
     * your pocket. The masks and the matching have to be the same.
     */
    @Test
    fun `ignores the same people the desktop ignores`() {
        val corpus = load("ignore.json")

        fun whoOf(e: JsonElement): Ignore.Who {
            val o = e.jsonObject
            return Ignore.Who(
                nick = o["nick"]!!.jsonPrimitive.content,
                user = o["user"]?.jsonPrimitive?.content,
                host = o["host"]?.jsonPrimitive?.content
            )
        }

        fun scopeOf(e: JsonElement): Ignore.Scope {
            val o = e.jsonObject
            return Ignore.Scope(
                messages = o["messages"]!!.jsonPrimitive.content == "true",
                requests = o["requests"]!!.jsonPrimitive.content == "true"
            )
        }

        fun entryOf(e: JsonElement): Ignore.Entry {
            val o = e.jsonObject
            return Ignore.Entry(
                mask = o["mask"]!!.jsonPrimitive.content,
                network = o["network"]!!.jsonPrimitive.content,
                scope = scopeOf(o["scope"]!!),
                added = o["added"]!!.jsonPrimitive.content.toLong()
            )
        }

        for (case in corpus["mask"]!!.jsonArray) {
            val c = case.jsonObject
            assertEquals(
                c["name"]!!.jsonPrimitive.content,
                c["mask"]!!.jsonPrimitive.content,
                Ignore.toMask(c["typed"]!!.jsonPrimitive.content)
            )
        }

        for (case in corpus["match"]!!.jsonArray) {
            val c = case.jsonObject
            assertEquals(
                c["name"]!!.jsonPrimitive.content,
                c["matches"]!!.jsonPrimitive.content == "true",
                Ignore.matches(c["mask"]!!.jsonPrimitive.content, whoOf(c["who"]!!))
            )
        }

        for (case in corpus["scope"]!!.jsonArray) {
            val c = case.jsonObject
            assertEquals(
                c["name"]!!.jsonPrimitive.content,
                c["ignored"]!!.jsonPrimitive.content == "true",
                Ignore.isIgnored(
                    c["list"]!!.jsonArray.map { entryOf(it) },
                    c["network"]!!.jsonPrimitive.content,
                    whoOf(c["who"]!!),
                    c["kind"]!!.jsonPrimitive.content
                )
            )
        }

        for (case in corpus["edit"]!!.jsonArray) {
            val c = case.jsonObject
            assertEquals(
                c["name"]!!.jsonPrimitive.content,
                c["masks"]!!.jsonArray.map { it.jsonPrimitive.content },
                Ignore.with(c["list"]!!.jsonArray.map { entryOf(it) }, entryOf(c["add"]!!))
                    .map { it.mask }
            )
        }
    }

    // ── SOCKS, byte for byte ─────────────────────────────────────────

    /**
     * A proxy is bytes on a wire, and the two clients have to produce the same
     * ones. A phone that greets a proxy slightly differently from the desktop
     * is a phone that cannot reach a network the desktop can.
     */
    @Test
    fun `speaks SOCKS the way the desktop speaks it`() {
        val corpus = load("socks.json")

        fun bytesOf(e: JsonElement?): ByteArray =
            e!!.jsonArray.map { (it.jsonPrimitive.content.toInt() and 0xff).toByte() }.toByteArray()

        fun expect(name: String, wanted: JsonElement?, got: ByteArray) =
            assertEquals(name, bytesOf(wanted).toList(), got.toList())

        for (case in corpus["greeting"]!!.jsonArray) {
            val c = case.jsonObject
            expect(
                c["name"]!!.jsonPrimitive.content,
                c["bytes"],
                Socks.greeting(c["hasCredentials"]!!.jsonPrimitive.content == "true")
            )
        }

        for (case in corpus["choice"]!!.jsonArray) {
            val c = case.jsonObject
            val wanted = c["method"]!!.let { if (it is JsonNull) null else it.jsonPrimitive.content.toInt() }
            assertEquals(
                c["name"]!!.jsonPrimitive.content,
                wanted,
                Socks.readChoice(bytesOf(c["bytes"]))
            )
        }

        for (case in corpus["auth"]!!.jsonArray) {
            val c = case.jsonObject
            expect(
                c["name"]!!.jsonPrimitive.content,
                c["bytes"],
                Socks.authRequest(
                    c["username"]!!.jsonPrimitive.content,
                    c["password"]!!.jsonPrimitive.content
                )
            )
        }

        for (case in corpus["authReply"]!!.jsonArray) {
            val c = case.jsonObject
            val wanted = c["ok"]!!.let { if (it is JsonNull) null else it.jsonPrimitive.content == "true" }
            assertEquals(
                c["name"]!!.jsonPrimitive.content,
                wanted,
                Socks.readAuthReply(bytesOf(c["bytes"]))
            )
        }

        for (case in corpus["connect5"]!!.jsonArray) {
            val c = case.jsonObject
            expect(
                c["name"]!!.jsonPrimitive.content,
                c["bytes"],
                Socks.connect5(
                    c["host"]!!.jsonPrimitive.content,
                    c["port"]!!.jsonPrimitive.content.toInt()
                )
            )
        }

        for (case in corpus["reply5"]!!.jsonArray) {
            val c = case.jsonObject
            val name = c["name"]!!.jsonPrimitive.content
            val reply = Socks.readReply5(bytesOf(c["bytes"]))
            val wanted = c["ok"]!!.let { if (it is JsonNull) null else it.jsonPrimitive.content == "true" }
            assertEquals(name, wanted, reply.ok)
            c["error"]?.let { assertEquals(name, it.jsonPrimitive.content, reply.error) }
            c["length"]?.let { assertEquals(name, it.jsonPrimitive.content.toInt(), reply.length) }
        }

        for (case in corpus["connect4"]!!.jsonArray) {
            val c = case.jsonObject
            expect(
                c["name"]!!.jsonPrimitive.content,
                c["bytes"],
                Socks.connect4(
                    c["host"]!!.jsonPrimitive.content,
                    c["port"]!!.jsonPrimitive.content.toInt(),
                    c["username"]!!.jsonPrimitive.content
                )
            )
        }

        for (case in corpus["reply4"]!!.jsonArray) {
            val c = case.jsonObject
            val name = c["name"]!!.jsonPrimitive.content
            val reply = Socks.readReply4(bytesOf(c["bytes"]))
            val wanted = c["ok"]!!.let { if (it is JsonNull) null else it.jsonPrimitive.content == "true" }
            assertEquals(name, wanted, reply.ok)
            c["error"]?.let { assertEquals(name, it.jsonPrimitive.content, reply.error) }
        }

        for (case in corpus["inUse"]!!.jsonArray) {
            val c = case.jsonObject
            val p = c["proxy"]!!.jsonObject
            assertEquals(
                c["name"]!!.jsonPrimitive.content,
                c["used"]!!.jsonPrimitive.content == "true",
                Socks.inUse(
                    Socks.Settings(
                        type = p["type"]!!.jsonPrimitive.content,
                        host = p["host"]!!.jsonPrimitive.content,
                        port = p["port"]!!.jsonPrimitive.content.toInt()
                    )
                )
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

    @Test
    fun `keeps a line said to services the way the desktop does`() {
        for (case in load("services.json")["secrets"]!!.jsonArray) {
            val c = case.jsonObject
            assertEquals(
                c["name"]!!.jsonPrimitive.content,
                c["shown"]!!.jsonPrimitive.content,
                Services.secretsMasked(
                    c["target"]!!.jsonPrimitive.content,
                    c["text"]!!.jsonPrimitive.content
                )
            )
        }
    }

    // ── irc:// links ─────────────────────────────────────────────────

    @Test
    fun `reads an irc link the way the desktop reads it`() {
        for (entry in load("ircurl.json")["cases"]!!.jsonArray) {
            val case = entry.jsonObject
            val name = case["name"]!!.jsonPrimitive.content
            val expected = (case["link"] as? JsonObject)?.let { link ->
                IrcUrl.Link(
                    host = link["host"]!!.jsonPrimitive.content,
                    port = link["port"]!!.jsonPrimitive.int,
                    tls = link["tls"]!!.jsonPrimitive.boolean,
                    channel = (link["channel"] as? JsonPrimitive)?.contentOrNull,
                    nick = (link["nick"] as? JsonPrimitive)?.contentOrNull
                )
            }
            assertEquals(name, expected, IrcUrl.parse(case["url"]!!.jsonPrimitive.content))
        }
    }

    // ── the nick to try next ─────────────────────────────────────────

    @Test
    fun `tries the same alternative nicks the desktop tries`() {
        for (entry in load("altnick.json")["cases"]!!.jsonArray) {
            val case = entry.jsonObject
            assertEquals(
                case["name"]!!.jsonPrimitive.content,
                case["next"]!!.jsonPrimitive.content,
                Nicks.nextToTry(
                    case["attempted"]!!.jsonPrimitive.content,
                    case["alternatives"]!!.jsonArray.map { it.jsonPrimitive.content },
                    case["tried"]!!.jsonArray.map { it.jsonPrimitive.content }
                )
            )
        }
    }

    // ── emoji by name ────────────────────────────────────────────────

    @Test
    fun `offers and finishes emoji names as the desktop does`() {
        val corpus = load("shortcodes.json")
        val table = Emoji.parse(corpus["table"]!!.jsonArray)
        for (entry in corpus["query"]!!.jsonArray) {
            val case = entry.jsonObject
            assertEquals(
                case["name"]!!.jsonPrimitive.content,
                (case["query"] as? JsonPrimitive)?.contentOrNull,
                Emoji.query(case["draft"]!!.jsonPrimitive.content)
            )
        }
        for (entry in corpus["candidates"]!!.jsonArray) {
            val case = entry.jsonObject
            assertEquals(
                case["name"]!!.jsonPrimitive.content,
                case["names"]!!.jsonArray.map { it.jsonPrimitive.content },
                Emoji.candidates(case["query"]!!.jsonPrimitive.content, table).map { it.name }
            )
        }
        for (entry in corpus["completed"]!!.jsonArray) {
            val case = entry.jsonObject
            assertEquals(
                case["name"]!!.jsonPrimitive.content,
                case["result"]!!.jsonPrimitive.content,
                Emoji.complete(case["draft"]!!.jsonPrimitive.content, case["emoji"]!!.jsonPrimitive.content)
            )
        }
        for (entry in corpus["replaced"]!!.jsonArray) {
            val case = entry.jsonObject
            assertEquals(
                case["name"]!!.jsonPrimitive.content,
                case["result"]!!.jsonPrimitive.content,
                Emoji.replaceShortcodes(case["text"]!!.jsonPrimitive.content, table)
            )
        }
    }

    // ── a certificate nobody vouches for ─────────────────────────────

    @Test
    fun `spells and compares a certificate fingerprint as the desktop does`() {
        val corpus = load("certificate.json")
        for (entry in corpus["format"]!!.jsonArray) {
            val case = entry.jsonObject
            assertEquals(
                case["name"]!!.jsonPrimitive.content,
                case["shown"]!!.jsonPrimitive.content,
                TrustedCertificate.format(case["raw"]!!.jsonPrimitive.content)
            )
        }
        for (entry in corpus["same"]!!.jsonArray) {
            val case = entry.jsonObject
            assertEquals(
                case["name"]!!.jsonPrimitive.content,
                case["same"]!!.jsonPrimitive.content == "true",
                TrustedCertificate.same(
                    (case["a"] as? JsonPrimitive)?.contentOrNull,
                    (case["b"] as? JsonPrimitive)?.contentOrNull
                )
            )
        }
    }

    // ── channel events ───────────────────────────────────────────────

    @Test
    fun `words a join, a kick or a topic change as the desktop does`() {
        val corpus = load("events.json")
        for (entry in corpus["lines"]!!.jsonArray) {
            val case = entry.jsonObject
            assertEquals(
                case["name"]!!.jsonPrimitive.content,
                case["line"]!!.jsonPrimitive.content,
                Events.line(
                    case["kind"]!!.jsonPrimitive.content,
                    case["nick"]!!.jsonPrimitive.content,
                    (case["detail"] as? JsonPrimitive)?.contentOrNull,
                    (case["reason"] as? JsonPrimitive)?.contentOrNull
                )
            )
        }
        for ((kind, hidden) in corpus["hidden"]!!.jsonObject) {
            assertEquals(kind, hidden.jsonPrimitive.content == "true", Events.isJoinOrPart(kind))
        }
    }

    // ── Klipy ────────────────────────────────────────────────────────

    @Test
    fun `picks the same Klipy files the desktop picks`() {
        val corpus = load("klipy.json")
        for (entry in corpus["picks"]!!.jsonArray) {
            val case = entry.jsonObject
            val name = case["name"]!!.jsonPrimitive.content
            val item = Klipy.Item(case["item"]!!.jsonObject)
            assertEquals(name, case["preview"]!!.jsonPrimitive.content, item.previewUrl)
            assertEquals(name, case["share"]!!.jsonPrimitive.content, item.shareUrl)
            assertEquals(name, case["video"]!!.jsonPrimitive.content == "true", item.hasVideo)
        }
        for (entry in corpus["results"]!!.jsonArray) {
            val case = entry.jsonObject
            assertEquals(
                case["name"]!!.jsonPrimitive.content,
                case["count"]!!.jsonPrimitive.content.toInt(),
                Klipy.parseResults(case["json"]!!).size
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

    /**
     * And about words you asked to be told about.
     *
     * Same corpus, same reason: a highlight word that rings the phone and does
     * not colour the desktop is two clients.
     */
    @Test
    fun `agrees with the desktop about words you watch for`() {
        for (case in load("mentions.json")["words"]!!.jsonArray) {
            val c = case.jsonObject
            assertEquals(
                c["name"]!!.jsonPrimitive.content,
                c["mentions"]!!.jsonPrimitive.content == "true",
                saysWatchedWord(
                    c["text"]!!.jsonPrimitive.content,
                    c["words"]!!.jsonArray.map { it.jsonPrimitive.content }
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

    // ── what a bouncer says about its networks ───────────────────────

    @Test
    fun `reads a bouncer's attributes the way the desktop reads them`() {
        for (case in load("bouncer.json")["attributes"]!!.jsonArray) {
            val c = case.jsonObject
            val expected = c["pairs"]!!.jsonObject.mapValues { (_, v) ->
                if (v is kotlinx.serialization.json.JsonNull) null else v.jsonPrimitive.content
            }
            assertEquals(
                c["name"]!!.jsonPrimitive.content,
                expected,
                Bouncer.attributes(c["text"]!!.jsonPrimitive.content)
            )
        }
    }

    @Test
    fun `builds the same network from them`() {
        fun network(o: kotlinx.serialization.json.JsonObject) = Bouncer.Network(
            id = o["id"]!!.jsonPrimitive.content,
            name = o["name"]!!.jsonPrimitive.content,
            host = o["host"]!!.jsonPrimitive.content,
            port = o["port"]!!.jsonPrimitive.int,
            tls = o["tls"]!!.jsonPrimitive.content.toBoolean(),
            nickname = o["nickname"]!!.jsonPrimitive.content,
            state = o["state"]!!.jsonPrimitive.content,
            error = o["error"].let { if (it == null || it is kotlinx.serialization.json.JsonNull) null else it.jsonPrimitive.content }
        )

        for (case in load("bouncer.json")["networks"]!!.jsonArray) {
            val c = case.jsonObject
            val previous = c["previous"].let {
                if (it == null || it is kotlinx.serialization.json.JsonNull) null else network(it.jsonObject)
            }
            assertEquals(
                c["name"]!!.jsonPrimitive.content,
                network(c["network"]!!.jsonObject),
                Bouncer.networkFrom(
                    c["id"]!!.jsonPrimitive.content,
                    Bouncer.attributes(c["text"]!!.jsonPrimitive.content),
                    previous
                )
            )
        }
    }

    @Test
    fun `recognises a bouncer the same way the desktop does`() {
        for (case in load("bouncer.json")["recognised"]!!.jsonArray) {
            val c = case.jsonObject
            val isupport = c["isupport"]!!.jsonObject.mapValues { (_, v) -> v.jsonPrimitive.content }
            val caps = c["caps"]!!.jsonArray.map { it.jsonPrimitive.content }
            assertEquals(
                c["name"]!!.jsonPrimitive.content,
                c["bouncer"]!!.jsonPrimitive.content.toBoolean(),
                Bouncer.isBouncer(isupport, caps)
            )
        }
    }

    @Test
    fun `binds to a bouncer network the same way the desktop does`() {
        for (case in load("bouncer.json")["bind"]!!.jsonArray) {
            val c = case.jsonObject
            val netId = c["netId"].let {
                if (it == null || it is kotlinx.serialization.json.JsonNull) null
                else it.jsonPrimitive.content
            }
            val negotiated = c["negotiated"]!!.jsonArray.map { it.jsonPrimitive.content }
            val expected = c["line"].let {
                if (it == null || it is kotlinx.serialization.json.JsonNull) null
                else it.jsonPrimitive.content
            }

            assertEquals(
                c["name"]!!.jsonPrimitive.content,
                expected,
                Bouncer.bindBeforeRegistration(netId, negotiated)
            )
        }
    }

    // ── the addresses a network answers on ───────────────────────────

    @Test
    fun `reads a written address the way the desktop reads it`() {
        for (case in load("addresses.json")["parse"]!!.jsonArray) {
            val c = case.jsonObject
            val fallback = c["fallback"]!!.jsonObject
            val got = Addresses.parse(
                c["text"]!!.jsonPrimitive.content,
                fallback["port"]!!.jsonPrimitive.int,
                fallback["tls"]!!.jsonPrimitive.content.toBoolean()
            )

            val expected = c["address"]
            if (expected == null || expected is kotlinx.serialization.json.JsonNull) {
                assertEquals(c["name"]!!.jsonPrimitive.content, null, got)
            } else {
                val want = expected.jsonObject
                assertEquals(
                    c["name"]!!.jsonPrimitive.content,
                    Addresses.Address(
                        want["host"]!!.jsonPrimitive.content,
                        want["port"]!!.jsonPrimitive.int,
                        want["tls"]!!.jsonPrimitive.content.toBoolean()
                    ),
                    got
                )
            }
        }
    }

    @Test
    fun `falls through them in the same order`() {
        val corpus = load("addresses.json")
        val c = corpus["attemptsConfig"]!!.jsonObject
        val config = ServerConfig(
            id = "a",
            name = "a",
            host = c["host"]!!.jsonPrimitive.content,
            port = c["port"]!!.jsonPrimitive.int,
            tls = c["tls"]!!.jsonPrimitive.content.toBoolean(),
            nick = "sbtest",
            altAddresses = c["altAddresses"]!!.jsonArray.map { it.jsonPrimitive.content }
        )

        for (case in corpus["attempts"]!!.jsonArray) {
            val a = case.jsonObject
            assertEquals(
                a["name"]!!.jsonPrimitive.content,
                a["host"]!!.jsonPrimitive.content,
                Addresses.forAttempt(config, a["attempt"]!!.jsonPrimitive.int).host
            )
        }
    }

    // ── which network an entry is ────────────────────────────────────

    @Test
    fun `knows the same network under two ids`() {
        for (case in load("netid.json")["same"]!!.jsonArray) {
            val c = case.jsonObject
            val a = c["a"]!!.jsonObject
            val b = c["b"]!!.jsonObject
            assertEquals(
                c["name"]!!.jsonPrimitive.content,
                c["same"]!!.jsonPrimitive.content.toBoolean(),
                NetworkId.key(
                    a["host"]!!.jsonPrimitive.content,
                    a["port"]!!.jsonPrimitive.int,
                    a["nick"]!!.jsonPrimitive.content
                ) == NetworkId.key(
                    b["host"]!!.jsonPrimitive.content,
                    b["port"]!!.jsonPrimitive.int,
                    b["nick"]!!.jsonPrimitive.content
                )
            )
        }
    }

    @Test
    fun `matches a config about to be adopted the way the desktop does`() {
        fun configs(array: kotlinx.serialization.json.JsonArray) = array.map {
            val o = it.jsonObject
            ServerConfig(
                id = o["id"]!!.jsonPrimitive.content,
                name = o["id"]!!.jsonPrimitive.content,
                host = o["host"]!!.jsonPrimitive.content,
                port = o["port"]!!.jsonPrimitive.int,
                nick = o["nick"]!!.jsonPrimitive.content
            )
        }

        for (case in load("netid.json")["reidentified"]!!.jsonArray) {
            val c = case.jsonObject
            val expected = c["moves"]!!.jsonObject
                .mapValues { (_, v) -> v.jsonPrimitive.content }

            assertEquals(
                c["name"]!!.jsonPrimitive.content,
                expected,
                NetworkId.reidentified(
                    configs(c["mine"]!!.jsonArray),
                    configs(c["theirs"]!!.jsonArray)
                )
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

    // ── going to one message ──────────────────────────────────────────

    @Test
    fun `decides a jump the same way the desktop does`() {
        val corpus = load("jump.json")
        val context = corpus["context"]!!.jsonPrimitive.int

        for (entry in corpus["plans"]!!.jsonArray) {
            val case = entry.jsonObject
            val loaded = case["loaded"]!!.jsonArray.map {
                val row = it.jsonObject
                Jump.Placed(
                    row["id"]!!.jsonPrimitive.content,
                    row["timestamp"]!!.jsonPrimitive.content
                )
            }
            val target = case["target"]!!.jsonObject
            val plan = Jump.plan(
                loaded,
                Jump.Target(
                    target["id"]!!.jsonPrimitive.contentOrNull,
                    target["timestamp"]!!.jsonPrimitive.content
                ),
                context
            )

            assertEquals(
                case["name"]!!.jsonPrimitive.content,
                case["plan"]!!.jsonPrimitive.content,
                plan.name.lowercase()
            )
        }
    }

    // ── searching every network at once ───────────────────────────────

    @Test
    fun `orders and labels search results the way the desktop does`() {
        val corpus = load("search.json")

        for (entry in corpus["where"]!!.jsonArray) {
            val case = entry.jsonObject
            assertEquals(
                case["name"]!!.jsonPrimitive.content,
                case["label"]!!.jsonPrimitive.content,
                Search.whereSaid(
                    case["channel"]!!.jsonPrimitive.content,
                    case["network"]!!.jsonPrimitive.content
                )
            )
        }

        for (entry in corpus["order"]!!.jsonArray) {
            val case = entry.jsonObject
            val found = case["found"]!!.jsonArray.map {
                val row = it.jsonObject
                fun text(key: String) = row[key]!!.jsonPrimitive.content
                Search.Found(
                    // Not in the corpus: the id is for going back to the line,
                    // and the order this checks does not depend on it
                    id = "",
                    serverId = text("serverId"),
                    network = text("network"),
                    channel = text("channel"),
                    nick = text("nick"),
                    content = text("content"),
                    timestamp = text("timestamp")
                )
            }

            assertEquals(
                case["name"]!!.jsonPrimitive.content,
                case["contents"]!!.jsonArray.map { it.jsonPrimitive.content },
                Search.newestFirst(found).map { it.content }
            )
        }
    }

    // ── the friend list ───────────────────────────────────────────────

    @Test
    fun `builds one friend list out of every network the way the desktop does`() {
        for (entry in load("friends.json")["roster"]!!.jsonArray) {
            val case = entry.jsonObject
            val watched = case["watched"]!!.jsonArray.map {
                val row = it.jsonObject
                Friends.Watched(
                    serverId = row["serverId"]!!.jsonPrimitive.content,
                    network = row["network"]!!.jsonPrimitive.content,
                    nick = row["nick"]!!.jsonPrimitive.content,
                    online = row["online"]!!.jsonPrimitive.boolean
                )
            }

            assertEquals(
                case["name"]!!.jsonPrimitive.content,
                case["labels"]!!.jsonArray.map { it.jsonPrimitive.content },
                Friends.roster(watched).map { it.label }
            )
        }
    }

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

    @Test
    fun `asks whether a token was advertised, not whether it was true`() {
        for (entry in load("advertises.json")["cases"]!!.jsonArray) {
            val case = entry.jsonObject
            val isupport = case["isupport"]!!.jsonObject.mapValues { (_, v) ->
                v.jsonPrimitive.contentOrNull ?: ""
            }
            assertEquals(
                case["name"]!!.jsonPrimitive.content,
                case["advertised"]!!.jsonPrimitive.boolean,
                Isupport.advertises(isupport, case["token"]!!.jsonPrimitive.content)
            )
        }

        for (entry in load("advertises.json")["numbers"]!!.jsonArray) {
            val case = entry.jsonObject
            val isupport = case["isupport"]!!.jsonObject.mapValues { (_, v) ->
                v.jsonPrimitive.contentOrNull ?: ""
            }
            assertEquals(
                case["name"]!!.jsonPrimitive.content,
                case["number"]!!.jsonPrimitive.intOrNull,
                Isupport.number(isupport, case["token"]!!.jsonPrimitive.content)
            )
        }
    }

    // ── avatars ───────────────────────────────────────────────────────

    @Test
    fun `only fetches an avatar it is willing to fetch`() {
        for (entry in load("avatar.json")["cases"]!!.jsonArray) {
            val case = entry.jsonObject
            assertEquals(
                case["name"]!!.jsonPrimitive.content,
                case["url"]!!.jsonPrimitive.contentOrNull,
                avatarUrl(case["value"]!!.jsonPrimitive.content)
            )
        }
        assertNull("nothing set", avatarUrl(null))
        assertNull(
            "a URL long enough to be a denial of service is not an avatar",
            avatarUrl("https://example.net/" + "a".repeat(4000))
        )
    }

    // ── client tags ───────────────────────────────────────────────────

    @Test
    fun `knows which client tags a network will carry`() {
        val corpus = load("clienttags.json")

        for (entry in corpus["carries"]!!.jsonArray) {
            val case = entry.jsonObject
            assertEquals(
                case["name"]!!.jsonPrimitive.content,
                case["carried"]!!.jsonPrimitive.boolean,
                ClientTags.carries(
                    case["deny"]!!.jsonPrimitive.contentOrNull,
                    case["tag"]!!.jsonPrimitive.content
                )
            )
        }

        for (entry in corpus["choose"]!!.jsonArray) {
            val case = entry.jsonObject
            assertEquals(
                case["name"]!!.jsonPrimitive.content,
                case["use"]!!.jsonPrimitive.contentOrNull,
                ClientTags.toUse(
                    case["deny"]!!.jsonPrimitive.contentOrNull,
                    case["names"]!!.jsonArray.map { it.jsonPrimitive.content }
                )
            )
        }
    }

    // ── decoding ──────────────────────────────────────────────────────

    @Test
    fun `reads a line in the encoding it was written in`() {
        for (entry in load("decoding.json")["cases"]!!.jsonArray) {
            val case = entry.jsonObject
            val hex = case["bytes"]!!.jsonPrimitive.content
            val bytes = ByteArray(hex.length / 2) {
                hex.substring(it * 2, it * 2 + 2).toInt(16).toByte()
            }
            assertEquals(
                case["name"]!!.jsonPrimitive.content,
                case["text"]!!.jsonPrimitive.content,
                Decoding.line(bytes)
            )
        }
    }

    @Test
    fun `never turns a byte that meant something into a replacement character`() {
        // Every byte 0x80-0xFF on its own is invalid UTF-8 and valid Windows-1252
        for (byte in 0x80..0xff) {
            val decoded = Decoding.line(byteArrayOf(byte.toByte()))
            assertEquals(1, decoded.length)
            assertTrue("0x%02x became a replacement character".format(byte), decoded != "\uFFFD")
        }
    }

    @Test
    fun `names an uploaded file the same way the desktop does`() {
        for (entry in load("filehost.json")["disposition"]!!.jsonArray) {
            val case = entry.jsonObject
            assertEquals(
                case["name"]!!.jsonPrimitive.content,
                case["header"]!!.jsonPrimitive.content,
                Filehost.contentDisposition(case["file"]!!.jsonPrimitive.content)
            )
        }
    }

    @Test
    fun `reads what a filehost said it takes the same way`() {
        for (entry in load("filehost.json")["accept"]!!.jsonArray) {
            val case = entry.jsonObject
            val accept = case["acceptPost"]!!.jsonPrimitive.contentOrNull
            assertEquals(
                case["name"]!!.jsonPrimitive.content,
                case["ok"]!!.jsonPrimitive.content.toBoolean(),
                Filehost.acceptsType(accept, case["type"]!!.jsonPrimitive.content)
            )
        }
    }

    @Test
    fun `reads a capability that goes by more than one name the same way`() {
        val features = mapOf(
            "webpush" to CapNames.WEBPUSH,
            "noImplicitNames" to CapNames.NO_IMPLICIT_NAMES
        )

        for (entry in load("capabilities.json")["aliases"]!!.jsonArray) {
            val case = entry.jsonObject
            val offered = case["offered"]!!.jsonArray.map { it.jsonPrimitive.content }
            val names = features[case["feature"]!!.jsonPrimitive.content]!!
            assertEquals(
                case["name"]!!.jsonPrimitive.content,
                case["negotiatedAs"]!!.jsonPrimitive.contentOrNull,
                CapNames.negotiatedAs(offered, names)
            )
        }
    }

    @Test
    fun `decides about a channel the server denies the same way the desktop does`() {
        for (entry in load("notonchannel.json")["cases"]!!.jsonArray) {
            val case = entry.jsonObject
            val have = case["have"]!!.jsonArray.map { Casemap.fold(it.jsonPrimitive.content) }.toSet()
            val channel = case["channel"]!!.jsonPrimitive.contentOrNull
            assertEquals(
                case["name"]!!.jsonPrimitive.content,
                case["action"]!!.jsonPrimitive.content,
                NotOnChannel.action(case["numeric"]!!.jsonPrimitive.content, channel) {
                    Casemap.fold(it) in have
                }
            )
        }
    }

    // ── which thing is holding the connections ────────────────────────

    @Test
    fun `names the holder the same way the desktop does`() {
        val corpus = load("holding.json")

        for (entry in corpus["cases"]!!.jsonArray) {
            val case = entry.jsonObject
            val now = case["now"]!!.jsonObject
            val flag = { key: String -> now[key]!!.jsonPrimitive.boolean }

            val holder = Holding.who(
                holding = flag("holding"),
                connecting = flag("connecting"),
                peerHolding = flag("peerHolding"),
                followingAlwaysOn = flag("followingAlwaysOn"),
                everPaired = flag("everPaired"),
                allThroughBouncer = flag("allThroughBouncer")
            )

            assertEquals(
                case["name"]!!.jsonPrimitive.content,
                case["holder"]!!.jsonPrimitive.content,
                holder.name.lowercase().replace('_', '-')
            )
        }

        // The words themselves, because two clients showing the same holder
        // under different names is the thing this file exists to stop.
        for ((holder, word) in corpus["labels"]!!.jsonObject) {
            assertEquals(
                holder,
                word.jsonPrimitive.content,
                Holding.label(Holding.Holder.valueOf(holder.uppercase().replace('-', '_')))
            )
        }
    }

    // ── answering CTCP ────────────────────────────────────────────────

    @Test
    fun `tells the three kinds of wrapped line apart the same way`() {
        val corpus = load("ctcp.json")

        for (entry in corpus["kinds"]!!.jsonArray) {
            val case = entry.jsonObject
            val kind = Ctcp.kind(
                case["command"]!!.jsonPrimitive.content,
                case["text"]!!.jsonPrimitive.content
            )
            assertEquals(
                case["name"]!!.jsonPrimitive.content,
                case["kind"]!!.jsonPrimitive.contentOrNull,
                kind?.name?.lowercase()
            )
        }

        for (entry in corpus["answerLines"]!!.jsonArray) {
            val case = entry.jsonObject
            assertEquals(
                case["name"]!!.jsonPrimitive.content,
                case["line"]!!.jsonPrimitive.content,
                Ctcp.answerLine(
                    case["from"]!!.jsonPrimitive.content,
                    case["body"]!!.jsonPrimitive.content
                )
            )
        }
    }

    @Test
    fun `answers a CTCP question the same way the desktop does`() {
        val corpus = load("ctcp.json")
        val version = corpus["version"]!!.jsonPrimitive.content
        val platform = corpus["platform"]!!.jsonPrimitive.content
        val now = java.time.Instant.parse(corpus["now"]!!.jsonPrimitive.content)

        for (entry in corpus["replies"]!!.jsonArray) {
            val case = entry.jsonObject
            assertEquals(
                case["name"]!!.jsonPrimitive.content,
                case["reply"]!!.jsonPrimitive.contentOrNull,
                Ctcp.reply(
                    case["verb"]!!.jsonPrimitive.content,
                    case["args"]!!.jsonPrimitive.content,
                    version,
                    platform,
                    now
                )
            )
        }
    }

    @Test
    fun `holds answers to the same rate the desktop holds them to`() {
        val guard = CtcpGuard()

        // Asking two or three things in a row is what asking looks like
        for (i in 0 until Ctcp.PER_ASKER) {
            assertEquals(true, guard.allow("asker", 1_000L + i * 100))
        }
        assertEquals(false, guard.allow("asker", 1_500))
        assertEquals(false, guard.allow("ASKER", 1_500))
        assertEquals(true, guard.allow("asker", 1_000 + Ctcp.WINDOW_MS))

        // A crowd asking at once is what a channel full of bots reacting to
        // one line looks like
        val crowd = CtcpGuard()
        for (i in 0 until Ctcp.TOTAL) assertEquals(true, crowd.allow("asker$i", 1_000L + i))
        assertEquals(false, crowd.allow("one-too-many", 1_100))
        assertEquals(true, crowd.allow("later", 1_000 + Ctcp.WINDOW_MS))
    }

    // ── uploading a file ──────────────────────────────────────────────

    @Test
    fun `agrees with the desktop about where a file goes`() {
        val corpus = load("filehost.json")

        for (entry in corpus["where"]!!.jsonArray) {
            val case = entry.jsonObject
            val isupport = case["isupport"]!!.jsonObject.mapValues { (_, v) ->
                v.jsonPrimitive.contentOrNull ?: ""
            }
            assertEquals(
                case["name"]!!.jsonPrimitive.content,
                case["url"]!!.jsonPrimitive.contentOrNull,
                Filehost.url(isupport)
            )
        }

        // The spec's MUST: a plaintext upload URI is refused when the IRC
        // connection is encrypted
        for (entry in corpus["tls"]!!.jsonArray) {
            val case = entry.jsonObject
            val isupport = case["isupport"]!!.jsonObject.mapValues { (_, v) ->
                v.jsonPrimitive.contentOrNull ?: ""
            }
            assertEquals(
                case["name"]!!.jsonPrimitive.content,
                case["url"]!!.jsonPrimitive.contentOrNull,
                Filehost.url(isupport, case["overTls"]!!.jsonPrimitive.content.toBoolean())
            )
        }

        for (entry in corpus["auth"]!!.jsonArray) {
            val case = entry.jsonObject
            assertEquals(
                "the password goes over https and nowhere else",
                case["mayAuthenticate"]!!.jsonPrimitive.boolean,
                Filehost.mayAuthenticate(case["url"]!!.jsonPrimitive.content)
            )
        }

        for (entry in corpus["resolved"]!!.jsonArray) {
            val case = entry.jsonObject
            assertEquals(
                case["name"]!!.jsonPrimitive.content,
                case["url"]!!.jsonPrimitive.contentOrNull,
                Filehost.uploaded(
                    case["location"]!!.jsonPrimitive.content,
                    case["base"]!!.jsonPrimitive.content
                )
            )
        }
    }

    @Test
    fun `knows when an edit means dialling again`() {
        fun config(from: JsonObject, base: ServerConfig) = base.copy(
            host = from["host"]?.jsonPrimitive?.contentOrNull ?: base.host,
            port = from["port"]?.jsonPrimitive?.intOrNull ?: base.port,
            tls = from["tls"]?.jsonPrimitive?.booleanOrNull ?: base.tls,
            websocketUrl = if (from.containsKey("websocketUrl"))
                from["websocketUrl"]?.jsonPrimitive?.contentOrNull
            else base.websocketUrl,
            trustedCertificate = if (from.containsKey("trustedCertificate"))
                from["trustedCertificate"]?.jsonPrimitive?.contentOrNull
            else base.trustedCertificate
        )

        for (entry in load("dial.json")["cases"]!!.jsonArray) {
            val case = entry.jsonObject
            val name = case["name"]!!.jsonPrimitive.content
            val blank = ServerConfig(id = "srv", name = "Test", host = "x", nick = "kara")

            val before = config(case["before"]!!.jsonObject, blank)
            val after = config(case["after"]!!.jsonObject, before)

            assertEquals(name, case["redial"]!!.jsonPrimitive.boolean, dialChanged(before, after))
        }
    }

    // ── finishing a half-typed name ───────────────────────────────────

    @Test
    fun `completes a name the way the desktop completes it`() {
        val corpus = load("completion.json")

        for (entry in corpus["matches"]!!.jsonArray) {
            val case = entry.jsonObject
            assertEquals(
                case["name"]!!.jsonPrimitive.content,
                case["completions"]!!.jsonArray.map { it.jsonPrimitive.content },
                Completion.matching(
                    case["partial"]!!.jsonPrimitive.content,
                    case["people"]!!.jsonArray.map { it.jsonPrimitive.content }
                )
            )
        }

        for (entry in corpus["mentions"]!!.jsonArray) {
            val case = entry.jsonObject
            val name = case["name"]!!.jsonPrimitive.content
            val draft = case["draft"]!!.jsonPrimitive.content
            val query = (case["query"] as? JsonPrimitive)?.contentOrNull
            assertEquals(name, query, Completion.mentionQuery(draft))
            val people = case["people"]!!.jsonArray.map { it.jsonPrimitive.content }
            assertEquals(
                name,
                case["candidates"]!!.jsonArray.map { it.jsonPrimitive.content },
                if (query == null) emptyList() else Completion.mentionCandidates(query, people)
            )
        }

        for (entry in corpus["mentioned"]!!.jsonArray) {
            val case = entry.jsonObject
            assertEquals(
                case["name"]!!.jsonPrimitive.content,
                case["result"]!!.jsonPrimitive.content,
                Completion.mentioned(
                    case["draft"]!!.jsonPrimitive.content,
                    case["nick"]!!.jsonPrimitive.content
                )
            )
        }

        for (entry in corpus["suffix"]!!.jsonArray) {
            val case = entry.jsonObject
            assertEquals(
                case["name"]!!.jsonPrimitive.content,
                case["result"]!!.jsonPrimitive.content,
                Completion.complete(
                    case["draft"]!!.jsonPrimitive.content,
                    case["completion"]!!.jsonPrimitive.content
                )
            )
        }
    }

    // ── away when nobody is there ─────────────────────────────────────

    /**
     * The two clients measure idleness differently and have to — the desktop
     * asks the system how long since any input, this counts from the screen
     * going dark. What they do with that number is one decision, and a
     * disagreement here is the two devices arguing about whether you are at
     * your keyboard.
     */
    @Test
    fun `goes away when the desktop would`() {
        val corpus = load("autoaway.json")

        for (entry in corpus["actions"]!!.jsonArray) {
            val case = entry.jsonObject
            val wanted = when (case["action"]!!.jsonPrimitive.content) {
                "set" -> AutoAway.Action.SET
                "clear" -> AutoAway.Action.CLEAR
                else -> AutoAway.Action.NOTHING
            }
            assertEquals(
                case["name"]!!.jsonPrimitive.content,
                wanted,
                AutoAway.action(
                    idleSeconds = case["idleSeconds"]!!.jsonPrimitive.long,
                    afterMinutes = case["afterMinutes"]!!.jsonPrimitive.int,
                    alreadyAway = case["alreadyAway"]!!.jsonPrimitive.boolean,
                    setByUs = case["setByUs"]!!.jsonPrimitive.boolean
                )
            )
        }

        for (entry in corpus["messages"]!!.jsonArray) {
            val case = entry.jsonObject
            assertEquals(
                case["name"]!!.jsonPrimitive.content,
                case["message"]!!.jsonPrimitive.content,
                AutoAway.message((case["configured"] as? JsonPrimitive)?.contentOrNull)
            )
        }
    }


    // ── links we are willing to open ──────────────────────────────────

    /**
     * A profile's homepage is a metadata key, so a stranger chose the string,
     * and both clients hand it to something that will attempt whatever scheme
     * it is given. The list of what we will attempt has to be the same list on
     * both, or a link that does nothing at a desk starts a program in a pocket.
     */
    @Test
    fun `opens only the links the desktop would open`() {
        for (entry in load("links.json")["safe"]!!.jsonArray) {
            val case = entry.jsonObject
            val wanted = (case["url"] as? JsonPrimitive)?.contentOrNull
            assertEquals(
                case["name"]!!.jsonPrimitive.content,
                wanted,
                Links.safeExternal(case["value"]!!.jsonPrimitive.content)
            )
        }

        assertNull("nothing at all", Links.safeExternal(null))
    }

    @Test
    fun `sees the same pictures and clips in addresses the desktop sees`() {
        for (entry in load("links.json")["media"]!!.jsonArray) {
            val case = entry.jsonObject
            val name = case["name"]!!.jsonPrimitive.content
            val url = case["url"]!!.jsonPrimitive.content
            assertEquals(name, case["image"]!!.jsonPrimitive.content == "true", Links.isImage(url))
            assertEquals(name, case["video"]!!.jsonPrimitive.content == "true", Links.isVideo(url))
            assertEquals(name, case["klipy"]!!.jsonPrimitive.content == "true", Links.isKlipyMedia(url))
        }
    }

    // ── what a connection failure is called ───────────────────────────

    /**
     * A certificate that does not match the address is what being intercepted
     * looks like, and both clients have to say so in the same words — the
     * event is the same and the person is the same person.
     */
    @Test
    fun `explains a failed connection the way the desktop does`() {
        val corpus = load("connectionerror.json")

        for (entry in corpus["cases"]!!.jsonArray) {
            val case = entry.jsonObject
            val wanted = when (case["problem"]!!.jsonPrimitive.content) {
                "wrong-host" -> ConnectionError.Problem.WRONG_HOST
                "untrusted" -> ConnectionError.Problem.UNTRUSTED
                "expired" -> ConnectionError.Problem.EXPIRED
                "refused" -> ConnectionError.Problem.REFUSED
                "not-found" -> ConnectionError.Problem.NOT_FOUND
                "timeout" -> ConnectionError.Problem.TIMEOUT
                "unreachable" -> ConnectionError.Problem.UNREACHABLE
                "reset" -> ConnectionError.Problem.RESET
                else -> ConnectionError.Problem.OTHER
            }
            assertEquals(
                case["name"]!!.jsonPrimitive.content,
                wanted,
                ConnectionError.problemOf(case["raw"]!!.jsonPrimitive.content)
            )
        }

        val rawFor = mapOf(
            "wrong-host" to "ERR_TLS_CERT_ALTNAME_INVALID",
            "untrusted" to "SELF_SIGNED_CERT_IN_CHAIN",
            "expired" to "CERT_HAS_EXPIRED",
            "refused" to "connect ECONNREFUSED 203.0.113.9:6697",
            "not-found" to "getaddrinfo ENOTFOUND irc.example.org",
            "timeout" to "connect ETIMEDOUT 203.0.113.9:6697",
            "unreachable" to "connect EHOSTUNREACH 203.0.113.9:6697",
            "reset" to "read ECONNRESET"
        )
        for (entry in corpus["sentences"]!!.jsonArray) {
            val case = entry.jsonObject
            assertEquals(
                case["name"]!!.jsonPrimitive.content,
                case["text"]!!.jsonPrimitive.content,
                ConnectionError.describe(
                    rawFor[case["problem"]!!.jsonPrimitive.content],
                    "irc.example.org"
                )
            )
        }

        // Anything we have no sentence for is passed through untouched
        assertEquals("EPROTO", ConnectionError.describe("EPROTO", "irc.example.org"))
        assertEquals("Could not connect", ConnectionError.describe(null, "irc.example.org"))
    }

    // ── what we keep from a metadata update ───────────────────────────

    /**
     * The value is a string a stranger chose, and a display name is drawn
     * beside every line somebody says. Both clients have to cut in the same
     * place, or the same profile reads differently on the two devices.
     */
    @Test
    fun `keeps the same metadata the desktop keeps`() {
        for (entry in load("metadata-keep.json")["cases"]!!.jsonArray) {
            val case = entry.jsonObject
            val name = case["name"]!!.jsonPrimitive.content
            val kept = Metadata.toKeep(
                case["key"]!!.jsonPrimitive.content,
                case["value"]!!.jsonPrimitive.content
            )
            val wanted = case["keep"] as? JsonObject
            if (wanted == null) {
                assertNull(name, kept)
            } else {
                assertEquals(name, wanted["key"]!!.jsonPrimitive.content, kept?.first)
                assertEquals(name, wanted["value"]!!.jsonPrimitive.content, kept?.second)
            }
        }
    }

    // ── getting back a line you already sent ──────────────────────────

    /**
     * Up and Down in the composer. The most-used key after Enter, and neither
     * client had it — so both learned it at once, and both have to mean the
     * same thing by it.
     */
    @Test
    fun `recalls a sent line the way the desktop does`() {
        for (entry in load("history.json")["cases"]!!.jsonArray) {
            val case = entry.jsonObject
            val name = case["name"]!!.jsonPrimitive.content

            var state = History.State()
            var box = ""
            for (step in case["steps"]!!.jsonArray) {
                val one = step.jsonObject
                when {
                    one.containsKey("send") -> {
                        state = History.remember(state, one["send"]!!.jsonPrimitive.content)
                        box = History.textOf(state)
                    }

                    one.containsKey("up") -> {
                        box = one["up"]!!.jsonPrimitive.content
                        state = History.older(state, box)
                        box = History.textOf(state)
                    }

                    one.containsKey("down") -> {
                        state = History.newer(state)
                        box = History.textOf(state)
                    }

                    one.containsKey("type") -> box = one["type"]!!.jsonPrimitive.content
                }
            }

            (case["text"] as? JsonPrimitive)?.let { assertEquals(name, it.content, box) }
            (case["lines"] as? JsonArray)?.let { wanted ->
                assertEquals(name, wanted.map { it.jsonPrimitive.content }, state.lines)
            }
        }
    }

    // ── whether to log in, and how ────────────────────────────────────

    /**
     * The two clients used to decide this differently and quietly: this one
     * authenticated whenever a password was saved and defaulted to PLAIN, the
     * desktop only when a mechanism had been picked. One config logged in here
     * and sat there as a stranger at the desk, with nothing on either screen
     * to explain it.
     */
    @Test
    fun `decides how to log in the way the desktop decides`() {
        val corpus = load("saslplan.json")

        for (entry in corpus["cases"]!!.jsonArray) {
            val case = entry.jsonObject
            val name = case["name"]!!.jsonPrimitive.content
            val c = case["config"]!!.jsonObject

            fun text(key: String): String? = (c[key] as? JsonPrimitive)?.contentOrNull

            val config = SaslPlan.Config(
                mechanism = text("mechanism"),
                username = text("username"),
                password = text("password"),
                clientCert = text("clientCert"),
                unreadable = (c["unreadable"] as? JsonArray)
                    ?.map { it.jsonPrimitive.content }.orEmpty()
            )
            val offered = (case["offered"] as? JsonArray)?.map { it.jsonPrimitive.content }

            when (val plan = SaslPlan.of(config, offered)) {
                is SaslPlan.Plan.Authenticate -> {
                    assertEquals(name, "authenticate", case["action"]!!.jsonPrimitive.content)
                    assertEquals(name, case["mechanism"]!!.jsonPrimitive.content, plan.mechanism)
                }

                is SaslPlan.Plan.Refuse -> {
                    assertEquals(name, "refuse", case["action"]!!.jsonPrimitive.content)
                    assertEquals(name, case["reason"]!!.jsonPrimitive.content, plan.reason)
                }

                SaslPlan.Plan.Skip ->
                    assertEquals(name, "skip", case["action"]!!.jsonPrimitive.content)
            }
        }

        for (entry in corpus["accounts"]!!.jsonArray) {
            val case = entry.jsonObject
            val config = SaslPlan.Config(
                username = (case["username"] as? JsonPrimitive)?.contentOrNull,
                password = "x"
            )
            assertEquals(
                case["name"]!!.jsonPrimitive.content,
                case["account"]!!.jsonPrimitive.content,
                SaslPlan.account(config, case["nick"]!!.jsonPrimitive.content)
            )
        }
    }

    // ── what a server-time tag may be ─────────────────────────────────

    /**
     * Both clients stored the `time` tag on trust. Here it later reached
     * `Instant.parse`, which throws — so a server could crash the transcript
     * export with `@time=soon`. Both cut the same cases now.
     */
    @Test
    fun `accepts the same timestamps the desktop accepts`() {
        for (entry in load("servertime.json")["cases"]!!.jsonArray) {
            val case = entry.jsonObject
            assertEquals(
                case["name"]!!.jsonPrimitive.content,
                (case["valid"] as? JsonPrimitive)?.contentOrNull,
                ServerTime.valid((case["value"] as? JsonPrimitive)?.contentOrNull)
            )
        }
        assertEquals("NOW", ServerTime.of("soon") { "NOW" })
        assertEquals("NOW", ServerTime.of(null) { "NOW" })
    }

    // ── addresses we will not connect to ──────────────────────────────

    /**
     * Wherever somebody else names an address this phone would then connect
     * to — a DCC offer — the same door must stay shut on both devices.
     */
    @Test
    fun `refuses the same addresses the desktop refuses`() {
        val corpus = load("privateaddress.json")
        for (entry in corpus["private"]!!.jsonArray) {
            val c = entry.jsonObject
            assertTrue(c["name"]!!.jsonPrimitive.content, PrivateAddress.isPrivate(c["address"]!!.jsonPrimitive.content))
        }
        for (entry in corpus["public"]!!.jsonArray) {
            val c = entry.jsonObject
            assertFalse(c["name"]!!.jsonPrimitive.content, PrivateAddress.isPrivate(c["address"]!!.jsonPrimitive.content))
        }
        for (entry in corpus["literals"]!!.jsonArray) {
            val c = entry.jsonObject
            assertEquals(c["value"]!!.jsonPrimitive.content, c["literal"]!!.jsonPrimitive.boolean,
                PrivateAddress.isIpLiteral(c["value"]!!.jsonPrimitive.content))
        }
    }

    // ── the lists a channel keeps ─────────────────────────────────────

    /**
     * Bans, quiets and the two exception lists. The Kotlin twin existed and
     * nothing checked it against the desktop, which is how the two panels
     * could have disagreed about what `+q` even is on a given network.
     */
    @Test
    fun `reads mask lists the way the desktop reads them`() {
        val corpus = load("masklists.json")

        for (entry in corpus["lists"]!!.jsonArray) {
            val c = entry.jsonObject
            val chanmodes = (c["chanmodes"] as? JsonPrimitive)?.contentOrNull
            assertEquals(
                c["name"]!!.jsonPrimitive.content,
                c["modes"]!!.jsonArray.map { it.jsonPrimitive.content },
                MaskLists.listsFor(chanmodes, c["prefix"]!!.jsonPrimitive.content).map { it.mode }
            )
        }

        for (entry in corpus["labels"]!!.jsonArray) {
            val c = entry.jsonObject
            val list = MaskLists.listsFor(
                c["chanmodes"]!!.jsonPrimitive.content, c["prefix"]!!.jsonPrimitive.content
            ).firstOrNull { it.mode == c["mode"]!!.jsonPrimitive.content }
            assertEquals(c["name"]!!.jsonPrimitive.content, c["label"]!!.jsonPrimitive.content, list?.label)
            assertEquals(c["name"]!!.jsonPrimitive.content, c["entry"]!!.jsonPrimitive.content, list?.entry)
        }

        for (entry in corpus["replies"]!!.jsonArray) {
            val c = entry.jsonObject
            val name = c["name"]!!.jsonPrimitive.content
            val reply = MaskLists.readReply(
                c["command"]!!.jsonPrimitive.content,
                c["params"]!!.jsonArray.map { it.jsonPrimitive.content }
            )
            if (c.containsKey("reply") && c["reply"] is JsonNull) {
                assertNull(name, reply); continue
            }
            assertEquals(name, c["mode"]!!.jsonPrimitive.content, reply?.mode)
            assertEquals(name, c["channel"]!!.jsonPrimitive.content, reply?.channel)
            assertEquals(name, c["done"]!!.jsonPrimitive.boolean, reply?.done)
            val wanted = c["entry"] as? JsonObject
            if (wanted == null) {
                assertNull(name, reply?.entry)
            } else {
                assertEquals(name, wanted["mask"]!!.jsonPrimitive.content, reply?.entry?.mask)
                assertEquals(name, (wanted["setBy"] as? JsonPrimitive)?.contentOrNull, reply?.entry?.setBy)
                assertEquals(name, (wanted["setAt"] as? JsonPrimitive)?.long, reply?.entry?.setAt)
            }
        }

        for (entry in corpus["masks"]!!.jsonArray) {
            val c = entry.jsonObject
            val typed = c["typed"]!!.jsonPrimitive.content
            assertEquals(c["name"]!!.jsonPrimitive.content, c["sent"]!!.jsonPrimitive.content, MaskLists.maskToSet(typed))
            assertEquals(c["name"]!!.jsonPrimitive.content, c["isMask"]!!.jsonPrimitive.boolean, MaskLists.looksLikeMask(typed))
        }
    }
}
