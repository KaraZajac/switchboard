package org.switchboard.android

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.switchboard.android.irc.ConnectionState
import org.switchboard.android.irc.Handlers
import org.switchboard.android.irc.Irc
import org.switchboard.android.irc.IrcSession
import org.switchboard.android.irc.ServerConfig

/**
 * Losing the nick, and what is said about it.
 *
 * The desktop has had `nickrecovery.test.ts` since it was written; this is the
 * phone's half. Every case here is one where being wrong is quiet: a nick
 * taken during registration has to be worked around without a word, because
 * SASL may still win it back a second later and warning about something that
 * did not happen is worse than saying nothing. And a name we asked for and
 * were refused has to be forgotten, or the next person to take it is mistaken
 * for us.
 */
class NickTest {

    private class Session(
        override val config: ServerConfig,
        override val state: ConnectionState
    ) : IrcSession {
        val sent = mutableListOf<String>()
        val events = mutableListOf<Pair<String, JsonObject>>()

        override fun send(command: String, vararg params: String) {
            sent.add(Irc.serialise(command, params.toList()))
        }

        override fun sendRaw(line: String) { sent.add(line) }
        override fun emit(channel: String, data: JsonElement) {
            events.add(channel to data.jsonObject)
        }
    }

    private lateinit var session: Session

    @Before
    fun setUp() {
        Handlers.installAll()
        val state = ConnectionState("srv")
        state.reset("kara")
        session = Session(
            ServerConfig(id = "srv", name = "Test", host = "irc.example.org", nick = "kara"),
            state
        )
    }

    private fun feed(line: String) = Handlers.dispatch(session, Irc.parse(line))
    private fun errors() = session.events.filter { it.first == "irc:error" }
        .mapNotNull { it.second["message"]?.jsonPrimitive?.contentOrNull }

    @Test
    fun `takes a fallback during registration and says nothing yet`() {
        feed(":irc.example.org 433 * kara :Nickname is already in use")

        assertEquals("kara_", session.state.nick)
        assertTrue("NICK kara_ goes out", session.sent.contains("NICK kara_"))
        assertTrue(
            "nothing is said: SASL may still win the name back a second later",
            errors().isEmpty()
        )
    }

    @Test
    fun `falls back again if the fallback is taken too`() {
        feed(":irc.example.org 433 * kara :Nickname is already in use")
        feed(":irc.example.org 433 * kara_ :Nickname is already in use")

        assertEquals("kara__", session.state.nick)
    }

    @Test
    fun `once registered, a refusal is worth saying out loud`() {
        feed(":irc.example.org 001 kara :Welcome")
        session.events.clear()

        feed(":irc.example.org 433 kara robin :Nickname is already in use")

        assertTrue("the user asked for this one and did not get it", errors().isNotEmpty())
        assertFalse(
            "and the nick is not quietly mangled behind their back",
            session.sent.contains("NICK robin_")
        )
    }

    @Test
    fun `keeps the server's own words about why`() {
        feed(":irc.example.org 001 kara :Welcome")
        session.events.clear()

        // "in use" and "registered to another account" are different problems
        // and only one of them is the user's to solve
        feed(":irc.example.org 433 kara robin :Nick is registered to another account")

        assertTrue(errors().any { it.contains("registered to another account") })
    }

    @Test
    fun `forgets a name it asked for and was refused`() {
        feed(":irc.example.org 001 kara :Welcome")
        session.state.pendingNick = "robin"

        feed(":irc.example.org 433 kara robin :Nickname is already in use")

        assertNull(
            "or the next person to take that name is mistaken for us",
            session.state.pendingNick
        )
    }

    @Test
    fun `takes the change when the server confirms the name we asked for`() {
        feed(":irc.example.org 001 kara :Welcome")
        session.state.pendingNick = "robin"

        feed(":kara!u@h NICK robin")

        assertEquals("robin", session.state.nick)
        assertNull(session.state.pendingNick)
    }

    @Test
    fun `does not take somebody else's change for its own`() {
        feed(":irc.example.org 001 kara :Welcome")

        feed(":stranger!u@h NICK someone-else")

        assertEquals("kara", session.state.nick)
    }

    @Test
    fun `explains the name it settled for, once that is settled`() {
        feed(":irc.example.org 433 * kara :Nickname is already in use")
        feed(":irc.example.org 001 kara_ :Welcome")

        assertTrue(
            "001 is where it becomes final, and where it is worth a word",
            errors().any { it.contains("kara_") && it.contains("kara") }
        )
    }

    @Test
    fun `stays quiet when we got the name we asked for`() {
        feed(":irc.example.org 001 kara :Welcome")

        assertTrue("nothing was in doubt", errors().isEmpty())
    }

    @Test
    fun `a nick the server will not allow at all is reported`() {
        feed(":irc.example.org 432 * ba!d :Erroneous nickname")

        assertTrue(errors().any { it.contains("Erroneous") })
    }
}
