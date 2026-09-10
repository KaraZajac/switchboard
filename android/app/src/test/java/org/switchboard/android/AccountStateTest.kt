package org.switchboard.android

import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * Knowing who the network thinks you are.
 *
 * The nick is what you are called; the account is what the network agrees you
 * own. The phone tracked neither the second one nor anything that happened to
 * it, so "am I logged in?" — the question behind most of what people ask
 * NickServ — had no answer anywhere in the app.
 */
class AccountStateTest {

    private lateinit var store: SwitchboardStore
    private val server = "s1"

    @Before
    fun setUp() {
        store = SwitchboardStore()
        store.servers[server] = Server(id = server, name = "Test", host = "h", nick = "kara")
        store.channels[server] = mutableListOf(Channel("#lounge"))
        store.activeServerId = server
        store.activeChannel = "#lounge"
    }

    private fun notice(from: String, text: String) = buildJsonObject {
        put("serverId", server)
        put("channel", "kara")
        put("message", buildJsonObject {
            put("id", "m1")
            put("nick", from)
            put("content", text)
            put("timestamp", "2026-09-10T12:00:00Z")
            put("type", "notice")
        })
    }

    // ── the account itself ───────────────────────────────────────────

    @Test
    fun `connecting carries the account we were logged in as`() {
        store.handleEvent("irc:connected", buildJsonObject {
            put("serverId", server)
            put("nick", "kara")
            put("account", "kara")
        })

        assertEquals("kara", store.servers[server]?.account)
    }

    @Test
    fun `logging in and out is followed`() {
        store.handleEvent("irc:account", buildJsonObject {
            put("serverId", server)
            put("nick", "kara")
            put("account", "kara")
        })
        assertEquals("kara", store.servers[server]?.account)

        store.handleEvent("irc:account", buildJsonObject {
            put("serverId", server)
            put("nick", "kara")
        })
        assertNull(store.servers[server]?.account)
    }

    @Test
    fun `somebody else logging in is not us logging in`() {
        store.handleEvent("irc:account", buildJsonObject {
            put("serverId", server)
            put("nick", "robin")
            put("account", "robin")
        })

        assertNull(store.servers[server]?.account)
    }

    // ── being asked to log in ────────────────────────────────────────

    @Test
    fun `NickServ asking us to identify raises the prompt`() {
        store.handleEvent(
            "irc:message",
            notice("NickServ", "This nickname is registered. Please identify via /msg NickServ IDENTIFY <password>.")
        )

        assertEquals(server, store.identifyPrompt?.serverId)
    }

    @Test
    fun `the same words from a person are not a prompt`() {
        store.handleEvent(
            "irc:message",
            notice("robin", "This nickname is registered, you know. Identify yourself!")
        )

        assertNull(store.identifyPrompt)
    }

    @Test
    fun `already logged in, there is nothing to ask for`() {
        store.servers[server] = store.servers[server]!!.copy(account = "kara")

        store.handleEvent("irc:message", notice("NickServ", "This nickname is registered."))

        assertNull(store.identifyPrompt)
    }

    @Test
    fun `logging in puts the prompt away`() {
        store.handleEvent("irc:message", notice("NickServ", "This nickname is registered."))
        assertTrue(store.identifyPrompt != null)

        store.handleEvent("irc:account", buildJsonObject {
            put("serverId", server)
            put("nick", "kara")
            put("account", "kara")
        })

        assertNull(store.identifyPrompt)
    }

    /**
     * A failed login is not one refusal among many: the connection carries on
     * regardless, and the user spends the evening on their own network as a
     * stranger without being told why.
     */
    @Test
    fun `a refused login stays on screen`() {
        store.handleEvent("irc:error", buildJsonObject {
            put("serverId", server)
            put("command", "SASL")
            put("message", "SASL authentication failed")
        })

        assertEquals(server, store.identifyPrompt?.serverId)
        assertEquals("SASL authentication failed", store.identifyPrompt?.text)
    }

    @Test
    fun `an ordinary refusal does not`() {
        store.handleEvent("irc:error", buildJsonObject {
            put("serverId", server)
            put("command", "TOPIC")
            put("message", "You're not a channel operator")
        })

        assertNull(store.identifyPrompt)
        assertEquals("You're not a channel operator", store.lastError?.text)
    }

    // ── registering ──────────────────────────────────────────────────

    @Test
    fun `a registration that needs verifying says so`() {
        store.handleEvent("irc:register", buildJsonObject {
            put("serverId", server)
            put("status", "VERIFICATION_REQUIRED")
            put("account", "kara")
            put("message", "Check your email")
        })

        assertEquals("VERIFICATION_REQUIRED", store.accountReply?.status)
        assertEquals("kara", store.accountReply?.account)
        assertEquals(false, store.accountReply?.failed)
    }

    @Test
    fun `the desktop's older name for the same event is read too`() {
        store.handleEvent("irc:account-registered", buildJsonObject {
            put("serverId", server)
            put("status", "SUCCESS")
            put("account", "kara")
            put("message", "You are now registered")
        })

        assertEquals("SUCCESS", store.accountReply?.status)
    }

    /**
     * Without this the screen that asked watches a spinner until it gives up:
     * a refusal arrives as an error, never as an answer to the question it
     * asked.
     */
    @Test
    fun `a refused registration ends the wait`() {
        store.handleEvent("irc:error", buildJsonObject {
            put("serverId", server)
            put("command", "REGISTER")
            put("code", "ACCOUNT_EXISTS")
            put("message", "That account already exists")
        })

        assertEquals("ACCOUNT_EXISTS", store.accountReply?.status)
        assertTrue(store.accountReply?.failed == true)
    }
}

/**
 * Where a message lands in the conversation.
 *
 * `chathistory` replays arrive as ordinary messages carrying their own
 * timestamps, and they were appended: a conversation from ten minutes ago sat
 * underneath one from ten seconds ago, with the day separator drawn twice.
 */
class MessageOrderTest {

    private lateinit var store: SwitchboardStore
    private val server = "s1"

    @Before
    fun setUp() {
        store = SwitchboardStore()
        store.servers[server] = Server(id = server, name = "Test", host = "h", nick = "kara")
        store.channels[server] = mutableListOf(Channel("#lounge"))
        store.activeServerId = server
        store.activeChannel = "#lounge"
    }

    private fun arrive(id: String, at: String, historical: Boolean = false) {
        store.handleEvent("irc:message", buildJsonObject {
            put("serverId", server)
            put("channel", "#lounge")
            put("message", buildJsonObject {
                put("id", id)
                put("nick", "robin")
                put("content", id)
                put("timestamp", at)
                put("type", "privmsg")
                if (historical) put("historical", true)
            })
        })
    }

    private fun order() = store.messagesFor(server, "#lounge").map { it.id }

    @Test
    fun `live messages keep the order they arrive in`() {
        arrive("a", "2026-09-10T12:00:00Z")
        arrive("b", "2026-09-10T12:00:01Z")
        arrive("c", "2026-09-10T12:00:02Z")

        assertEquals(listOf("a", "b", "c"), order())
    }

    @Test
    fun `history arriving afterwards goes where it belongs`() {
        arrive("live", "2026-09-10T12:05:00Z")
        arrive("old1", "2026-09-10T11:00:00Z", historical = true)
        arrive("old2", "2026-09-10T11:30:00Z", historical = true)

        assertEquals(listOf("old1", "old2", "live"), order())
    }

    @Test
    fun `a message from the middle finds the middle`() {
        arrive("first", "2026-09-10T10:00:00Z")
        arrive("last", "2026-09-10T14:00:00Z")
        arrive("middle", "2026-09-10T12:00:00Z", historical = true)

        assertEquals(listOf("first", "middle", "last"), order())
    }

    @Test
    fun `the same message twice is still one message`() {
        arrive("a", "2026-09-10T12:00:00Z")
        arrive("a", "2026-09-10T12:00:00Z")

        assertEquals(listOf("a"), order())
    }

    @Test
    fun `a message with no timestamp goes at the end`() {
        arrive("a", "2026-09-10T12:00:00Z")
        arrive("b", "")

        assertEquals(listOf("a", "b"), order())
    }
}

/**
 * Whether a line is about you.
 *
 * Three parts of the app asked this and gave three answers: the notifier used a
 * word-boundary regex, the badge used a plain substring — so "karaoke" counted
 * as somebody saying "kara" — and the conversation did not ask at all.
 */
class MentionTest {

    @Test
    fun `your name as a word is you`() {
        assertTrue(namesYou("kara: are you there?", "kara"))
        assertTrue(namesYou("thanks kara", "kara"))
        assertTrue(namesYou("(kara)", "kara"))
        assertTrue(namesYou("KARA are you about", "kara"))
    }

    @Test
    fun `your name inside a longer word is not`() {
        assertFalse(namesYou("we went to karaoke", "kara"))
        assertFalse(namesYou("okara is a soy product", "kara"))
    }

    /** IRC nicks may contain []{}\`|^- , so those are part of the word too */
    @Test
    fun `another nick that starts with yours is not you`() {
        assertFalse(namesYou("kara[work]: ping", "kara"))
        assertFalse(namesYou("kara-bot said no", "kara"))
        assertTrue(namesYou("kara[work]: ping", "kara[work]"))
    }

    @Test
    fun `a nick with regex characters in it is matched literally`() {
        assertTrue(namesYou("hello {kara}", "{kara}"))
        assertFalse(namesYou("hello xkarax", "{kara}"))
    }

    @Test
    fun `nobody is mentioned when there is no nick to mention`() {
        assertFalse(namesYou("anything at all", ""))
    }
}
