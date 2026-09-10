package org.switchboard.android

import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
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
