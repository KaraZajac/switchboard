package org.switchboard.android

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.switchboard.android.irc.ConnectionState
import org.switchboard.android.irc.Handlers
import org.switchboard.android.irc.Irc
import org.switchboard.android.irc.IrcConnection
import org.switchboard.android.irc.IrcSession
import org.switchboard.android.irc.ServerConfig

/**
 * Capability negotiation on the phone.
 *
 * The desktop has had `capability.test.ts` and `capreq.test.ts` since it was
 * written; this is the phone's half. Getting any of it wrong fails silently:
 * only advertised capabilities are requested, so a wrong name is not an error
 * but an absence — the feature never turns on and nothing is logged. And
 * registration is held open until CAP END, so ending it a line early loses
 * whatever had not been answered, while never ending it hangs the connection
 * before 001.
 */
class CapabilityTest {

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

    /** The capabilities asked for, in the order they were asked for */
    private fun requested(): List<String> = session.sent
        .filter { it.startsWith("CAP REQ") }
        .flatMap { it.removePrefix("CAP REQ ").removePrefix(":").split(" ") }
        .filter { it.isNotEmpty() }

    // ── what we ask for ───────────────────────────────────────────────

    @Test
    fun `asks only for what the server advertised`() {
        feed(":irc.example.org CAP * LS :multi-prefix server-time nonsense-cap")

        // In our own order of preference, not the server's order of listing —
        // the same order the desktop asks in, which is what makes the two
        // negotiate identically against the same network
        assertEquals(listOf("server-time", "multi-prefix"), requested())
    }

    @Test
    fun `keeps a capability's value without asking for it`() {
        feed(":irc.example.org CAP * LS :sasl=PLAIN,EXTERNAL server-time")

        assertEquals("PLAIN,EXTERNAL", session.state.available["sasl"])
        assertTrue("the name is asked for, not the name and its value",
            requested().contains("sasl"))
    }

    @Test
    fun `waits for the rest of a multi-line listing before asking`() {
        feed(":irc.example.org CAP * LS * :multi-prefix")
        assertTrue("nothing is requested until the last line", requested().isEmpty())

        feed(":irc.example.org CAP * LS :server-time")
        assertEquals(listOf("server-time", "multi-prefix"), requested())
    }

    @Test
    fun `ends negotiation at once when the server offers nothing we want`() {
        feed(":irc.example.org CAP * LS :nonsense-cap")

        assertTrue(requested().isEmpty())
        assertEquals(listOf("CAP END"), session.sent)
    }

    // ── splitting the request ─────────────────────────────────────────

    @Test
    fun `splits a long list across lines that each fit`() {
        // Everything the client knows how to ask for, which is far more than
        // one 512-byte line holds
        val all = IrcConnection.WANTED_CAPABILITIES
        feed(":irc.example.org CAP * LS :" + all.joinToString(" "))

        val lines = session.sent.filter { it.startsWith("CAP REQ") }
        assertTrue("a list this long needs more than one line", lines.size > 1)
        for (line in lines) {
            assertTrue(
                "a CAP REQ has to fit in one message: ${line.length}",
                line.toByteArray().size + 2 <= IrcConnection.MAX_LINE_BYTES
            )
        }
    }

    @Test
    fun `asks for everything, exactly once, in order`() {
        val all = IrcConnection.WANTED_CAPABILITIES
        feed(":irc.example.org CAP * LS :" + all.joinToString(" "))

        assertEquals(all, requested())
    }

    @Test
    fun `counts the lines, so CAP END waits for the last answer`() {
        val all = IrcConnection.WANTED_CAPABILITIES
        feed(":irc.example.org CAP * LS :" + all.joinToString(" "))

        val lines = session.sent.filter { it.startsWith("CAP REQ") }
        assertEquals(lines.size, session.state.pendingCapRequests)

        // Answer all but the last: registration must stay open
        for (line in lines.dropLast(1)) {
            feed(":irc.example.org CAP kara ACK :" + line.substringAfter(":"))
        }
        assertFalse("CAP END must not go early", session.sent.contains("CAP END"))

        feed(":irc.example.org CAP kara ACK :" + lines.last().substringAfter(":"))
        assertTrue("and must go once the last is answered", session.sent.contains("CAP END"))
    }

    // ── the answers ───────────────────────────────────────────────────

    @Test
    fun `an ACK records what was granted and ends negotiation`() {
        feed(":irc.example.org CAP * LS :multi-prefix server-time")
        feed(":irc.example.org CAP kara ACK :multi-prefix server-time")

        assertTrue(session.state.capabilities.contains("multi-prefix"))
        assertTrue(session.state.capabilities.contains("server-time"))
        assertTrue(session.sent.contains("CAP END"))
    }

    @Test
    fun `a NAK ends negotiation too, rather than waiting for ever`() {
        feed(":irc.example.org CAP * LS :multi-prefix")
        feed(":irc.example.org CAP kara NAK :multi-prefix")

        assertFalse("nothing was granted", session.state.capabilities.contains("multi-prefix"))
        assertTrue("but registration still has to finish", session.sent.contains("CAP END"))
    }

    @Test
    fun `CAP NEW asks for something the server has only just offered`() {
        feed(":irc.example.org CAP * LS :multi-prefix")
        feed(":irc.example.org CAP kara ACK :multi-prefix")
        session.sent.clear()

        feed(":irc.example.org CAP kara NEW :server-time")

        assertEquals(listOf("server-time"), requested())
        assertFalse(
            "a second CAP END would end a registration that is already over",
            session.sent.contains("CAP END")
        )
    }

    @Test
    fun `CAP DEL takes one away again`() {
        feed(":irc.example.org CAP * LS :multi-prefix server-time")
        feed(":irc.example.org CAP kara ACK :multi-prefix server-time")

        feed(":irc.example.org CAP kara DEL :server-time")

        assertTrue(session.state.capabilities.contains("multi-prefix"))
        assertFalse(session.state.capabilities.contains("server-time"))
    }

    // ── SASL holds the door open ──────────────────────────────────────

    @Test
    fun `with SASL to do, CAP END waits for the exchange`() {
        val withSasl = Session(
            session.config.copy(saslMechanism = "PLAIN", saslPassword = "hunter2"),
            session.state
        )
        Handlers.dispatch(withSasl, Irc.parse(":irc.example.org CAP * LS :sasl=PLAIN"))
        Handlers.dispatch(withSasl, Irc.parse(":irc.example.org CAP kara ACK :sasl"))

        assertTrue("authentication starts", withSasl.sent.any { it.startsWith("AUTHENTICATE") })
        assertFalse(
            "and CAP END waits for it, or the account arrives after the nick",
            withSasl.sent.contains("CAP END")
        )
    }

    @Test
    fun `a mechanism the server does not offer is said out loud, not left to fail`() {
        val withSasl = Session(
            session.config.copy(saslMechanism = "SCRAM-SHA-512", saslPassword = "hunter2"),
            session.state
        )
        Handlers.dispatch(withSasl, Irc.parse(":irc.example.org CAP * LS :sasl=PLAIN,EXTERNAL"))
        Handlers.dispatch(withSasl, Irc.parse(":irc.example.org CAP kara ACK :sasl"))

        val errors = withSasl.events.filter { it.first == "irc:error" }
        assertTrue("a bare 904 tells the user their password is wrong", errors.isNotEmpty())
        assertTrue(
            "and says what the server does take",
            errors.any { it.second.toString().contains("PLAIN") }
        )
        assertTrue("registration still finishes", withSasl.sent.contains("CAP END"))
    }
}
