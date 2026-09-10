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

/**
 * The friend list.
 *
 * MONITOR is the only way IRC answers "tell me when they turn up", and the
 * phone had half of it: you could ask, but never see what you had asked for,
 * and — following a desktop — never hear the answer, because the two sides used
 * different names for the same two events.
 */
class WatchTest {

    private lateinit var store: SwitchboardStore
    private val server = "s1"

    @Before
    fun setUp() {
        store = SwitchboardStore()
        store.servers[server] = Server(id = server, name = "Test", host = "h", nick = "kara")
    }

    @Test
    fun `the desktop's names for coming and going are understood`() {
        store.setWatched(server, listOf("robin"))

        store.handleEvent("irc:monitor-online", buildJsonObject {
            put("serverId", server)
            put("nick", "robin")
        })
        assertTrue(store.isOnline(server, "robin"))

        store.handleEvent("irc:monitor-offline", buildJsonObject {
            put("serverId", server)
            put("nick", "robin")
        })
        assertFalse(store.isOnline(server, "robin"))
    }

    @Test
    fun `case does not decide whether your friend is online`() {
        store.handleEvent("irc:monitor-online", buildJsonObject {
            put("serverId", server)
            put("nick", "Robin")
        })

        assertTrue(store.isOnline(server, "robin"))
        assertTrue(store.isOnline(server, "ROBIN"))
    }

    @Test
    fun `the same nick on another network is somebody else`() {
        store.handleEvent("irc:monitor-online", buildJsonObject {
            put("serverId", server)
            put("nick", "robin")
        })

        assertFalse(store.isOnline("other", "robin"))
    }

    @Test
    fun `a MONITOR L reply fills the list without losing what is there`() {
        store.setWatched(server, listOf("robin"))

        store.handleEvent("irc:monitor-list", buildJsonObject {
            put("serverId", server)
            put("targets", "mara,robin,vic")
        })

        assertEquals(listOf("robin", "mara", "vic"), store.watchedFor(server))
    }
}

/**
 * Being away.
 *
 * A phone is the device most likely to be away from its person, and the two
 * clients describe it differently: ours says so with a flag, the desktop says
 * so by whether there is a message. Reading only the flag meant that following
 * a desktop, nobody was ever away — the event arrived and was dropped on its
 * first line.
 */
class AwayTest {

    private lateinit var store: SwitchboardStore
    private val server = "s1"

    @Before
    fun setUp() {
        store = SwitchboardStore()
        store.servers[server] = Server(id = server, name = "Test", host = "h", nick = "kara")
        store.channels[server] = mutableListOf(Channel("#lounge"))
        store.handleEvent("irc:names", buildJsonObject {
            put("serverId", server)
            put("channel", "#lounge")
            put("users", kotlinx.serialization.json.buildJsonArray {
                add(buildJsonObject { put("nick", "robin") })
                add(buildJsonObject { put("nick", "kara") })
            })
        })
    }

    @Test
    fun `our own flag is understood`() {
        store.handleEvent("irc:away", buildJsonObject {
            put("serverId", server)
            put("nick", "robin")
            put("away", true)
        })

        assertTrue(store.membersFor(server, "#lounge").first { it.nick == "robin" }.away)
    }

    @Test
    fun `the desktop's shape is understood too`() {
        store.handleEvent("irc:away", buildJsonObject {
            put("serverId", server)
            put("nick", "robin")
            put("message", "back in ten")
        })
        assertTrue(store.membersFor(server, "#lounge").first { it.nick == "robin" }.away)

        // The desktop says "back" by sending no message at all
        store.handleEvent("irc:away", buildJsonObject {
            put("serverId", server)
            put("nick", "robin")
        })
        assertFalse(store.membersFor(server, "#lounge").first { it.nick == "robin" }.away)
    }

    @Test
    fun `our own away state is followed, so the panel can offer to undo it`() {
        store.handleEvent("irc:away", buildJsonObject {
            put("serverId", server)
            put("nick", "kara")
            put("away", true)
        })
        assertTrue(store.servers[server]?.away == true)

        store.handleEvent("irc:away", buildJsonObject {
            put("serverId", server)
            put("nick", "kara")
            put("away", false)
        })
        assertFalse(store.servers[server]?.away == true)
    }
}

/**
 * Typing indicators.
 *
 * A server with echo-message sends our own TAGMSG back to us, so the phone
 * announced that we were typing — to us, while we were doing it.
 */
class TypingTest {

    private lateinit var store: SwitchboardStore
    private val server = "s1"

    @Before
    fun setUp() {
        store = SwitchboardStore()
        store.servers[server] = Server(id = server, name = "Test", host = "h", nick = "kara")
        store.channels[server] = mutableListOf(Channel("#lounge"))
    }

    private fun typing(nick: String, state: String) {
        store.handleEvent("irc:typing", buildJsonObject {
            put("serverId", server)
            put("channel", "#lounge")
            put("nick", nick)
            put("state", state)
        })
    }

    @Test
    fun `somebody else typing is worth showing`() {
        typing("robin", "active")
        assertEquals(listOf("robin"), store.typingIn(server, "#lounge"))
    }

    @Test
    fun `we are not told that we are typing`() {
        typing("kara", "active")
        typing("KARA", "active")
        assertTrue(store.typingIn(server, "#lounge").isEmpty())
    }

    @Test
    fun `done and paused both stop it`() {
        typing("robin", "active")
        typing("robin", "done")
        assertTrue(store.typingIn(server, "#lounge").isEmpty())

        typing("robin", "active")
        typing("robin", "paused")
        assertTrue(store.typingIn(server, "#lounge").isEmpty())
    }
}

/**
 * Reading on the other device.
 *
 * `draft/read-marker` is how the two clients agree about what has been seen.
 * Drawing the divider and leaving the badge lit is half the feature: catching
 * up in bed and still finding forty unread in the morning is the thing it
 * exists to prevent.
 */
class ReadMarkerTest {

    private lateinit var store: SwitchboardStore
    private val server = "s1"

    @Before
    fun setUp() {
        store = SwitchboardStore()
        store.servers[server] = Server(id = server, name = "Test", host = "h", nick = "kara")
        store.channels[server] = mutableListOf(Channel("#lounge"))
        // Somewhere else, so arriving messages count as unread
        store.activeServerId = server
        store.activeChannel = "#elsewhere"
    }

    private fun arrive(id: String, at: String, text: String = "hello") {
        store.handleEvent("irc:message", buildJsonObject {
            put("serverId", server)
            put("channel", "#lounge")
            put("message", buildJsonObject {
                put("id", id)
                put("nick", "robin")
                put("content", text)
                put("timestamp", at)
                put("type", "privmsg")
            })
        })
    }

    private fun read(at: String) {
        store.handleEvent("irc:read-marker", buildJsonObject {
            put("serverId", server)
            put("channel", "#lounge")
            put("timestamp", at)
        })
    }

    private fun unread() = store.channelsFor(server).first { it.name == "#lounge" }.unread

    @Test
    fun `reading it elsewhere puts the badge out`() {
        arrive("a", "2026-09-10T12:00:00Z")
        arrive("b", "2026-09-10T12:00:01Z")
        assertEquals(2, unread())

        read("2026-09-10T12:00:01Z")
        assertEquals(0, unread())
    }

    @Test
    fun `a mention counted there is cleared too`() {
        arrive("a", "2026-09-10T12:00:00Z", "kara: are you there?")
        assertEquals(1, store.channelsFor(server).first { it.name == "#lounge" }.mentions)

        read("2026-09-10T12:00:00Z")
        assertEquals(0, store.channelsFor(server).first { it.name == "#lounge" }.mentions)
    }

    /** A channel that moved on since it was read is unread again */
    @Test
    fun `a marker older than the newest message leaves the badge alone`() {
        arrive("a", "2026-09-10T12:00:00Z")
        arrive("b", "2026-09-10T12:05:00Z")

        read("2026-09-10T12:00:00Z")
        assertEquals(2, unread())
    }

    @Test
    fun `a marker for a channel with nothing in it is harmless`() {
        read("2026-09-10T12:00:00Z")
        assertEquals(0, unread())
    }
}

/**
 * A conversation that started while this device was closed.
 *
 * Channels look after themselves — rejoining one asks for its history. A DM
 * does not: nothing is joined, so a message from somebody this phone has never
 * spoken to leaves no trace at all for a client that was not connected to watch
 * it arrive. `CHATHISTORY TARGETS` is the only way to find it.
 */
class MissedConversationTest {

    private lateinit var store: SwitchboardStore
    private val server = "s1"

    @Before
    fun setUp() {
        store = SwitchboardStore()
        store.servers[server] = Server(id = server, name = "Test", host = "h", nick = "kara")
        store.channels[server] = mutableListOf(Channel("#lounge"))
    }

    private fun target(name: String) {
        store.handleEvent("irc:chathistory-target", buildJsonObject {
            put("serverId", server)
            put("target", name)
            put("timestamp", "2026-09-10T12:00:00Z")
        })
    }

    @Test
    fun `somebody who messaged us gets a conversation`() {
        target("mara")

        assertTrue(store.channelsFor(server).any { it.name == "mara" })
        assertTrue(store.missedConversations.contains("$server:mara"))
    }

    @Test
    fun `a channel is not a missed conversation`() {
        target("#somewhere")

        assertFalse(store.channelsFor(server).any { it.name == "#somewhere" })
    }

    /** Services talk to everybody; a NickServ notice is not a conversation */
    @Test
    fun `services do not get one either`() {
        target("NickServ")

        assertFalse(store.channelsFor(server).any { it.name.equals("NickServ", true) })
    }

    @Test
    fun `a conversation already on screen is left alone`() {
        store.openConversation(server, "robin")
        val before = store.channelsFor(server).size

        target("robin")

        assertEquals(before, store.channelsFor(server).size)
        assertTrue(store.missedConversations.isEmpty())
    }
}
