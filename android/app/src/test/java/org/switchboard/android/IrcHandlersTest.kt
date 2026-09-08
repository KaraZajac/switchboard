package org.switchboard.android

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.switchboard.android.irc.ConnectionState
import org.switchboard.android.irc.Handlers
import org.switchboard.android.irc.Irc
import org.switchboard.android.irc.IrcSession
import org.switchboard.android.irc.ServerConfig
import org.switchboard.android.irc.consumedByBatch

/**
 * The phone's IRC engine.
 *
 * It has to reach the same conclusions the desktop would about a channel,
 * because the two swap places and a user should not be able to tell which one
 * is currently on the network. These are the cases where a client that is
 * merely nearly right produces a roster nobody can trust.
 */
class IrcHandlersTest {

    /** A session whose socket is a list of lines and whose UI is a list of events */
    private class Session(
        override val config: ServerConfig,
        override val state: ConnectionState
    ) : IrcSession {
        val sent = mutableListOf<String>()
        val events = mutableListOf<Pair<String, JsonObject>>()

        override fun send(command: String, vararg params: String) {
            sent.add(Irc.serialise(command, params.toList()))
        }

        override fun sendRaw(line: String) {
            sent.add(line)
        }

        override fun emit(channel: String, data: JsonElement) {
            events.add(channel to data.jsonObject)
        }

        fun eventsOn(channel: String) = events.filter { it.first == channel }.map { it.second }
    }

    private lateinit var session: Session

    private fun config(vararg autoJoin: String) = ServerConfig(
        id = "srv",
        name = "Test",
        host = "irc.example.org",
        port = 6667,
        tls = false,
        nick = "kara",
        autoJoin = autoJoin.toList(),
        profile = mapOf("display-name" to "Kara", "pronouns" to "she/her")
    )

    @Before
    fun setUp() {
        Handlers.installAll()
        val state = ConnectionState("srv")
        state.reset("kara")
        session = Session(config("#chan"), state)
    }

    private fun feed(line: String) {
        val message = Irc.parse(line)
        if (message.command == "PING") return
        if (consumedByBatch(session.state, message)) return
        Handlers.dispatch(session, message)
    }

    /** Get on to the network with the capabilities named */
    private fun register(vararg caps: String) {
        session.state.capabilities.addAll(caps)
        feed(":irc.example.org 001 kara :Welcome")
        session.sent.clear()
        session.events.clear()
    }

    private fun JsonObject.str(key: String) = this[key]?.jsonPrimitive?.contentOrNull
    private fun JsonObject.bool(key: String) = this[key]?.jsonPrimitive?.booleanOrNull

    // ── Registration ─────────────────────────────────────────────────

    @Test
    fun `001 marks us registered and joins the configured channels`() {
        feed(":irc.example.org 001 kara :Welcome to the network")

        assertTrue(session.state.registered)
        assertEquals("kara", session.state.nick)
        assertTrue(session.sent.contains("JOIN #chan"))
        assertEquals(1, session.eventsOn("irc:connected").size)
    }

    @Test
    fun `publishes the profile after registration, never before`() {
        session.state.capabilities.add("draft/metadata-2")

        // Nothing has been sent yet — capability negotiation is not the moment
        assertTrue(session.sent.none { it.startsWith("METADATA") })

        feed(":irc.example.org 001 kara :Welcome")

        val metadata = session.sent.filter { it.startsWith("METADATA") }
        assertTrue(metadata.any { it.startsWith("METADATA * SUB") })
        assertTrue(metadata.contains("METADATA * SET display-name Kara"))
        assertTrue(metadata.contains("METADATA * SET pronouns she/her"))
    }

    @Test
    fun `reads PREFIX out of ISUPPORT, so modes map to symbols`() {
        feed(":irc.example.org 005 kara PREFIX=(qaohv)~&@%+ CHANMODES=beI,k,l,imnst :are supported")

        assertEquals("qaohv", session.state.prefixModes)
        assertEquals("~&@%+", session.state.prefixSymbols)
        assertEquals("@", session.state.prefixForMode('o'))
        assertEquals('v', session.state.modeForPrefix('+'))
    }

    @Test
    fun `takes a fallback nick when ours is in use, before registration`() {
        feed(":irc.example.org 433 * kara :Nickname is already in use")

        assertEquals("kara_", session.state.nick)
        assertTrue(session.sent.contains("NICK kara_"))
    }

    // ── Channels ─────────────────────────────────────────────────────

    @Test
    fun `builds the roster from NAMES, with prefixes`() {
        register("no-implicit-names")
        feed(":kara!u@h JOIN #chan")
        feed(":irc.example.org 353 kara = #chan :@alice +bob carol")
        feed(":irc.example.org 366 kara #chan :End of /NAMES list")

        val channel = session.state.findChannel("#chan")!!
        assertEquals(listOf("@"), channel.user("alice")?.prefixes)
        assertEquals(listOf("+"), channel.user("bob")?.prefixes)
        assertEquals(emptyList<String>(), channel.user("carol")?.prefixes)
        assertTrue(channel.namesReceived)
    }

    @Test
    fun `reads multi-prefix and userhost-in-names entries`() {
        register()
        feed(":kara!u@h JOIN #chan")
        feed(":irc.example.org 353 kara = #chan :@+alice!aa@host.example carol")
        feed(":irc.example.org 366 kara #chan :End of /NAMES list")

        val alice = session.state.findChannel("#chan")!!.user("alice")!!
        assertEquals(listOf("@", "+"), alice.prefixes)
        assertEquals("aa", alice.user)
        assertEquals("host.example", alice.host)
    }

    @Test
    fun `asks for NAMES on join only when the server will not send it`() {
        register("no-implicit-names")
        feed(":kara!u@h JOIN #chan")
        assertTrue(session.sent.contains("NAMES #chan"))

        session.sent.clear()
        session.state.capabilities.remove("no-implicit-names")
        feed(":kara!u@h JOIN #other")
        assertFalse(session.sent.any { it.startsWith("NAMES") })
    }

    @Test
    fun `records extended-join details`() {
        register("extended-join")
        feed(":kara!u@h JOIN #chan")
        feed(":alice!aa@host JOIN #chan bobaccount :Alice Example")

        val alice = session.state.findChannel("#chan")!!.user("alice")!!
        assertEquals("bobaccount", alice.account)
        assertEquals("Alice Example", alice.realname)
    }

    @Test
    fun `a mode change moves the prefix, and only for that person`() {
        register()
        feed(":irc.example.org 005 kara PREFIX=(ov)@+ CHANMODES=beI,k,l,imnst :are supported")
        feed(":kara!u@h JOIN #chan")
        feed(":irc.example.org 353 kara = #chan :alice bob")
        feed(":irc.example.org 366 kara #chan :End of /NAMES list")

        feed(":op!u@h MODE #chan +o alice")
        val channel = session.state.findChannel("#chan")!!
        assertEquals(listOf("@"), channel.user("alice")?.prefixes)
        assertEquals(emptyList<String>(), channel.user("bob")?.prefixes)

        feed(":op!u@h MODE #chan -o alice")
        assertEquals(emptyList<String>(), channel.user("alice")?.prefixes)
    }

    @Test
    fun `counts mode arguments correctly, so later modes hit the right nick`() {
        register()
        feed(":irc.example.org 005 kara PREFIX=(ov)@+ CHANMODES=beI,k,l,imnst :are supported")
        feed(":kara!u@h JOIN #chan")
        feed(":irc.example.org 353 kara = #chan :alice bob")
        feed(":irc.example.org 366 kara #chan :End of /NAMES list")

        // +l takes an argument when set, +m takes none; getting that wrong
        // shifts every following mode onto the wrong nick
        feed(":op!u@h MODE #chan +lmo 50 alice")

        val channel = session.state.findChannel("#chan")!!
        assertEquals(listOf("@"), channel.user("alice")?.prefixes)
        assertEquals(emptyList<String>(), channel.user("bob")?.prefixes)
        assertEquals("50", channel.modes["l"])
        assertTrue(channel.modes.containsKey("m"))
    }

    @Test
    fun `leaving a channel forgets it, someone else leaving does not`() {
        register()
        feed(":kara!u@h JOIN #chan")
        feed(":alice!u@h JOIN #chan")

        feed(":alice!u@h PART #chan :bye")
        assertNotNull(session.state.findChannel("#chan"))
        assertNull(session.state.findChannel("#chan")?.user("alice"))

        feed(":kara!u@h PART #chan :bye")
        assertNull(session.state.findChannel("#chan"))
    }

    @Test
    fun `a rename carries the channel over`() {
        register("draft/channel-rename")
        feed(":kara!u@h JOIN #old")
        feed(":alice!u@h JOIN #old")
        feed(":irc.example.org RENAME #old #new :tidying up")

        assertNull(session.state.findChannel("#old"))
        assertNotNull(session.state.findChannel("#new")?.user("alice"))
    }

    // ── People ───────────────────────────────────────────────────────

    @Test
    fun `a nick change follows the person through every channel`() {
        register()
        feed(":kara!u@h JOIN #chan")
        feed(":kara!u@h JOIN #other")
        feed(":alice!u@h JOIN #chan")
        feed(":alice!u@h JOIN #other")

        feed(":alice!u@h NICK alice2")

        assertNull(session.state.findChannel("#chan")?.user("alice"))
        assertNotNull(session.state.findChannel("#chan")?.user("alice2"))
        assertNotNull(session.state.findChannel("#other")?.user("alice2"))
    }

    @Test
    fun `our own nick change updates who we think we are`() {
        register()
        feed(":kara!u@h NICK kara2")
        assertEquals("kara2", session.state.nick)
        assertTrue(session.state.isMe("KARA2"))
    }

    @Test
    fun `away-notify flips the flag both ways`() {
        register("away-notify")
        feed(":kara!u@h JOIN #chan")
        feed(":alice!u@h JOIN #chan")

        feed(":alice!u@h AWAY :out to lunch")
        assertEquals(true, session.state.findChannel("#chan")?.user("alice")?.away)

        feed(":alice!u@h AWAY")
        assertEquals(false, session.state.findChannel("#chan")?.user("alice")?.away)
    }

    @Test
    fun `account-notify records a login and a logout`() {
        register("account-notify")
        feed(":kara!u@h JOIN #chan")
        feed(":alice!u@h JOIN #chan")

        feed(":alice!u@h ACCOUNT aliceacct")
        assertEquals("aliceacct", session.state.findChannel("#chan")?.user("alice")?.account)

        feed(":alice!u@h ACCOUNT *")
        assertNull(session.state.findChannel("#chan")?.user("alice")?.account)
    }

    @Test
    fun `chghost and setname update in place`() {
        register("chghost", "setname")
        feed(":kara!u@h JOIN #chan")
        feed(":alice!old@oldhost JOIN #chan")

        feed(":alice!old@oldhost CHGHOST newuser newhost")
        feed(":alice!newuser@newhost SETNAME :Alice New")

        val alice = session.state.findChannel("#chan")!!.user("alice")!!
        assertEquals("newuser", alice.user)
        assertEquals("newhost", alice.host)
        assertEquals("Alice New", alice.realname)
    }

    @Test
    fun `a quit removes the person from every channel`() {
        register()
        feed(":kara!u@h JOIN #chan")
        feed(":kara!u@h JOIN #other")
        feed(":alice!u@h JOIN #chan")
        feed(":alice!u@h JOIN #other")

        feed(":alice!u@h QUIT :Connection reset")

        assertNull(session.state.findChannel("#chan")?.user("alice"))
        assertNull(session.state.findChannel("#other")?.user("alice"))
    }

    // ── Messages ─────────────────────────────────────────────────────

    @Test
    fun `a channel message is filed under the channel`() {
        register()
        feed("@time=2026-09-08T12:00:00.000Z;msgid=abc :alice!u@h PRIVMSG #chan :hello")

        val event = session.eventsOn("irc:message").single()
        assertEquals("#chan", event.str("channel"))
        val message = event["message"]!!.jsonObject
        assertEquals("alice", message.str("nick"))
        assertEquals("hello", message.str("content"))
        assertEquals("abc", message.str("id"))
        assertEquals("2026-09-08T12:00:00.000Z", message.str("timestamp"))
    }

    @Test
    fun `a private message is filed under the sender, not under us`() {
        register()
        feed(":alice!u@h PRIVMSG kara :just between us")

        assertEquals("alice", session.eventsOn("irc:message").single().str("channel"))
    }

    @Test
    fun `a typing tag becomes a typing event`() {
        register("message-tags")
        feed("@+typing=active :alice!u@h TAGMSG #chan")

        val event = session.eventsOn("irc:typing").single()
        assertEquals("alice", event.str("nick"))
        assertEquals("active", event.str("state"))
    }

    @Test
    fun `a reaction carries the message it is about`() {
        register("message-tags")
        feed("@+draft/react=👍;+draft/reply=abc123 :alice!u@h TAGMSG #chan")

        val event = session.eventsOn("irc:react").single()
        assertEquals("👍", event.str("emoji"))
        assertEquals("abc123", event.str("msgid"))
        assertEquals(false, event.bool("removed"))
    }

    @Test
    fun `a redaction names the message being taken back`() {
        register("draft/message-redaction")
        feed(":alice!u@h REDACT #chan abc123 :posted by mistake")

        val event = session.eventsOn("irc:redact").single()
        assertEquals("abc123", event.str("msgid"))
        assertEquals("posted by mistake", event.str("reason"))
    }

    // ── Batches ──────────────────────────────────────────────────────

    @Test
    fun `a JOIN replayed from history does not drive live state`() {
        register("batch", "draft/chathistory", "draft/event-playback")
        feed(":kara!u@h JOIN #chan")
        feed(":alice!u@h JOIN #chan")
        session.sent.clear()

        feed(":irc.example.org BATCH +h chathistory #chan")
        feed("@batch=h :someone!u@h JOIN #chan")
        feed("@batch=h :alice!u@h QUIT :Connection closed")
        feed(":irc.example.org BATCH -h")

        // Nothing was sent in reply to history — no sync storm
        assertTrue(session.sent.toString(), session.sent.isEmpty())
        // And alice, who is still here, was not removed by a week-old quit
        assertNotNull(session.state.findChannel("#chan")?.user("alice"))
    }

    @Test
    fun `history replays as messages`() {
        register("batch", "draft/chathistory")
        feed(":irc.example.org BATCH +h chathistory #chan")
        feed("@batch=h;time=2026-09-01T10:00:00.000Z;msgid=old1 :alice!u@h PRIVMSG #chan :first")
        feed("@batch=h;time=2026-09-01T10:01:00.000Z;msgid=old2 :bob!u@h PRIVMSG #chan :second")
        feed(":irc.example.org BATCH -h")

        val messages = session.eventsOn("irc:message")
        assertEquals(2, messages.size)
        assertEquals("first", messages[0]["message"]!!.jsonObject.str("content"))
        assertEquals(true, messages[0]["message"]!!.jsonObject.bool("historical"))
    }

    @Test
    fun `a multiline batch arrives as one message`() {
        register("batch", "draft/multiline")
        feed(":irc.example.org BATCH +m draft/multiline #chan")
        feed("@batch=m;msgid=one :alice!u@h PRIVMSG #chan :first line")
        feed("@batch=m :alice!u@h PRIVMSG #chan :second line")
        feed(":irc.example.org BATCH -m")

        val message = session.eventsOn("irc:message").single()["message"]!!.jsonObject
        assertEquals("first line\nsecond line", message.str("content"))
    }

    @Test
    fun `multiline-concat joins without a newline`() {
        register("batch", "draft/multiline")
        feed(":irc.example.org BATCH +m draft/multiline #chan")
        feed("@batch=m :alice!u@h PRIVMSG #chan :a very long ")
        feed("@batch=m;draft/multiline-concat :alice!u@h PRIVMSG #chan :word")
        feed(":irc.example.org BATCH -m")

        val message = session.eventsOn("irc:message").single()["message"]!!.jsonObject
        assertEquals("a very long word", message.str("content"))
    }

    @Test
    fun `a names batch passes through, so the roster still builds`() {
        register("batch")
        feed(":kara!u@h JOIN #chan")

        feed(":irc.example.org BATCH +n names #chan")
        feed("@batch=n :irc.example.org 353 kara = #chan :kara alice")
        feed("@batch=n :irc.example.org 366 kara #chan :End of /NAMES list")
        feed(":irc.example.org BATCH -n")

        assertNotNull(session.state.findChannel("#chan")?.user("alice"))
        // …and exactly once
        assertEquals(1, session.eventsOn("irc:names").size)
    }

    // ── Metadata ─────────────────────────────────────────────────────

    @Test
    fun `761 records and announces a profile value`() {
        register("draft/metadata-2")
        feed(":irc.example.org 761 kara alice pronouns * :she/her")

        val event = session.eventsOn("irc:metadata").single()
        assertEquals("alice", event.str("target"))
        assertEquals("pronouns", event.str("key"))
        assertEquals("she/her", event.str("value"))
        assertEquals("she/her", session.state.metadata["alice"]?.get("pronouns"))
    }

    @Test
    fun `a cleared key is remembered as cleared`() {
        register("draft/metadata-2")
        feed(":irc.example.org 761 kara alice pronouns * :she/her")
        feed(":irc.example.org 766 kara alice pronouns :no such key")

        assertNull(session.state.metadata["alice"]?.get("pronouns"))
        assertEquals("", session.eventsOn("irc:metadata").last().str("value"))
    }

    @Test
    fun `syncs a channel on join and a person when they arrive`() {
        register("draft/metadata-2")
        feed(":kara!u@h JOIN #chan")
        assertTrue(session.sent.contains("METADATA #chan SYNC"))

        session.sent.clear()
        feed(":alice!u@h JOIN #chan")
        assertTrue(session.sent.contains("METADATA alice SYNC"))
    }

    // ── Errors ───────────────────────────────────────────────────────

    @Test
    fun `a standard reply becomes something the UI can show`() {
        register("standard-replies")
        feed(":irc.example.org FAIL JOIN CHANNEL_FULL #chan :Channel is full")

        val reply = session.eventsOn("irc:standard-reply").single()
        assertEquals("JOIN", reply.str("command"))
        assertEquals("CHANNEL_FULL", reply.str("code"))
        assertEquals("Channel is full", reply.str("message"))
        // …and a plain error too, so it is visible without special handling
        assertEquals(1, session.eventsOn("irc:error").size)
    }

    @Test
    fun `numeric errors carry their own text when the server gives one`() {
        register()
        feed(":irc.example.org 474 kara #chan :Cannot join channel (+b)")

        val error = session.eventsOn("irc:error").single()
        assertEquals("474", error.str("code"))
        assertEquals("#chan", error.str("target"))
        assertEquals("Cannot join channel (+b)", error.str("error"))
    }

    // ── MONITOR ──────────────────────────────────────────────────────

    @Test
    fun `monitor replies name the person, not their whole mask`() {
        register("monitor")
        feed(":irc.example.org 730 kara :alice!u@h,bob!u@h")

        val online = session.eventsOn("irc:monitor")
        assertEquals(listOf("alice", "bob"), online.map { it.str("nick") })
        assertTrue(online.all { it.bool("online") == true })
    }

    @Test
    fun `an unreact takes the reaction back`() {
        register("message-tags")
        feed("@+draft/unreact=👍;+draft/reply=abc123 :alice!u@h TAGMSG #chan")

        val event = session.eventsOn("irc:react").single()
        assertEquals("👍", event.str("emoji"))
        assertEquals(true, event.bool("removed"))
    }

    @Test
    fun `a reaction with nothing to react to is ignored`() {
        register("message-tags")
        feed("@+draft/react=👍 :alice!u@h TAGMSG #chan")
        assertTrue(session.eventsOn("irc:react").isEmpty())
    }

    // ── following our own nick change ─────────────────────────────────

    /**
     * A NICK carries the old nick in its prefix, which is how a client knows
     * the change is its own. A server that puts the new one there instead
     * matches nobody, and the phone spends the session under a name it does not
     * have — its own messages stop looking like its own.
     */
    @Test
    fun `takes a nick change announced with the old nick in the prefix`() {
        register()
        session.state.nick = "kara_"
        session.state.desiredNick = "kara"

        feed(":kara_!kara@host NICK kara")

        assertEquals("kara", session.state.nick)
    }

    @Test
    fun `takes a nick change announced with the new nick in the prefix`() {
        register()
        session.state.nick = "kara_"
        session.state.desiredNick = "kara"
        session.state.pendingNick = "kara"

        feed(":kara!kara@host NICK kara")

        assertEquals("kara", session.state.nick)
        assertNull(session.state.pendingNick)
    }

    @Test
    fun `does not claim a nick change it never asked for`() {
        register()
        session.state.nick = "kara_"
        session.state.desiredNick = "kara"

        feed(":robin!robin@host NICK kara")

        assertEquals("kara_", session.state.nick)
    }

    @Test
    fun `forgets a nick the server refused`() {
        register()
        session.state.nick = "kara_"
        session.state.pendingNick = "kara"

        feed(":irc.example.org 433 kara_ kara :Nickname is already in use")
        assertNull(session.state.pendingNick)

        feed(":robin!robin@host NICK kara")
        assertEquals("kara_", session.state.nick)
    }
}
