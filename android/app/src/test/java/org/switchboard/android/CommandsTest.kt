package org.switchboard.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.switchboard.android.irc.Commands
import org.switchboard.android.irc.ConnectionState
import org.switchboard.android.irc.IrcCommandTarget

/**
 * Slash commands on the phone.
 *
 * These exist because they did not: holding its own connection, the phone sent
 * everything typed straight to the channel, so `/msg NickServ IDENTIFY hunter2`
 * published the password to the room. The first test is that one.
 *
 * The rest check the same answers `src/main/irc/commands.ts` gives, because two
 * clients that disagree about what `/part` means are two clients.
 */
class CommandsTest {

    /** A connection that records instead of connecting */
    private class Target(override val state: ConnectionState) : IrcCommandTarget {
        val calls = mutableListOf<String>()

        override fun send(command: String, vararg params: String) {
            calls.add("send $command ${params.joinToString(" ")}".trim())
        }
        override fun sendRaw(line: String) { calls.add("raw $line") }
        override fun say(target: String, text: String) { calls.add("say $target :$text") }
        override fun action(target: String, text: String) { calls.add("action $target :$text") }
        override fun notice(target: String, text: String) { calls.add("notice $target :$text") }
        override fun join(channel: String, key: String?) {
            calls.add("join $channel${key?.let { " $it" } ?: ""}")
        }
        override fun part(channel: String, reason: String?) {
            calls.add("part $channel${reason?.let { " :$it" } ?: ""}")
        }
        override fun setTopic(channel: String, topic: String) { calls.add("topic $channel :$topic") }
        override fun setNick(nick: String) { calls.add("nick $nick") }
        override fun whois(nick: String) { calls.add("whois $nick") }
        override fun setAway(message: String?) { calls.add("away ${message ?: ""}".trim()) }
        override fun setMode(target: String, mode: String, vararg args: String) {
            calls.add("mode $target $mode ${args.joinToString(" ")}".trim())
        }
        override fun kick(channel: String, nick: String, reason: String?) {
            calls.add("kick $channel $nick${reason?.let { " :$it" } ?: ""}")
        }
        override fun invite(nick: String, channel: String) { calls.add("invite $nick $channel") }
        override fun stop(quitMessage: String) { calls.add("quit :$quitMessage") }
    }

    private lateinit var target: Target

    @Before
    fun setUp() {
        val state = ConnectionState("srv")
        state.reset("kara")
        target = Target(state)
    }

    private fun run(text: String, on: String = "#chan") = Commands.run(target, on, text)

    // ── the reason this file exists ──────────────────────────────────

    @Test
    fun `a password sent to NickServ does not reach the channel`() {
        val result = run("/msg NickServ IDENTIFY hunter2")

        assertTrue(result.handled)
        assertNull(result.error)
        assertEquals(listOf("say NickServ :IDENTIFY hunter2"), target.calls)
    }

    @Test
    fun `an unknown command is refused rather than said out loud`() {
        val result = run("/idenify hunter2")

        assertTrue(result.handled)
        assertEquals("Unknown command: /idenify", result.error)
        assertTrue(target.calls.isEmpty())
    }

    @Test
    fun `ordinary text is not a command`() {
        val result = run("hello everyone")

        assertFalse(result.handled)
        assertNull(result.message)
        assertTrue(target.calls.isEmpty())
    }

    @Test
    fun `a doubled slash sends one literal slash`() {
        val result = run("//afk for a bit")

        assertFalse(result.handled)
        assertEquals("/afk for a bit", result.message)
    }

    // ── the everyday ones ────────────────────────────────────────────

    @Test
    fun `join adds the hash when it was left off`() {
        run("/join lobby")
        assertEquals(listOf("join #lobby"), target.calls)
    }

    @Test
    fun `join passes a channel key through`() {
        run("/j #secret sesame")
        assertEquals(listOf("join #secret sesame"), target.calls)
    }

    @Test
    fun `part with no argument leaves the channel you are in`() {
        run("/part", on = "#lobby")
        assertEquals(listOf("part #lobby"), target.calls)
    }

    @Test
    fun `part with a reason keeps the reason whole`() {
        run("/part bye for now", on = "#lobby")
        assertEquals(listOf("part #lobby :bye for now"), target.calls)
    }

    @Test
    fun `part naming another channel leaves that one instead`() {
        run("/part #elsewhere gone", on = "#lobby")
        assertEquals(listOf("part #elsewhere :gone"), target.calls)
    }

    @Test
    fun `me sends an action`() {
        run("/me waves")
        assertEquals(listOf("action #chan :waves"), target.calls)
    }

    @Test
    fun `me with nothing to do says so`() {
        assertEquals("/me needs something to do", run("/me").error)
        assertTrue(target.calls.isEmpty())
    }

    @Test
    fun `topic only works in a channel`() {
        val result = run("/topic hello", on = "robin")

        assertEquals("/topic only works in a channel", result.error)
        assertTrue(target.calls.isEmpty())
    }

    @Test
    fun `topic with no text asks what the topic is`() {
        run("/topic", on = "#lobby")
        assertEquals(listOf("send TOPIC #lobby"), target.calls)
    }

    /**
     * TOPICLEN is not a refusal on the wire — the server takes the command and
     * silently keeps the first N bytes. Saying so now is the only chance the
     * user gets to choose which half survives.
     */
    @Test
    fun `a topic longer than the network allows is refused with the numbers`() {
        target.state.isupport["TOPICLEN"] = "10"

        val result = run("/topic a topic considerably longer than ten", on = "#lobby")

        assertEquals(
            "This network allows 10 characters in a topic and yours is 36.",
            result.error
        )
        assertTrue(target.calls.isEmpty())
    }

    @Test
    fun `a topic is measured in bytes, the way the server measures it`() {
        target.state.isupport["TOPICLEN"] = "8"

        // Three characters, nine bytes: a client counting characters would let
        // this through and watch the server cut it.
        assertTrue(run("/topic 日本語", on = "#lobby").error!!.endsWith("yours is 9."))
    }

    @Test
    fun `mode on the current channel is recognised by its shape`() {
        run("/mode +o robin", on = "#lobby")
        assertEquals(listOf("mode #lobby +o robin"), target.calls)
    }

    @Test
    fun `mode naming a target uses it`() {
        run("/mode #other +m", on = "#lobby")
        assertEquals(listOf("mode #other +m"), target.calls)
    }

    @Test
    fun `mode with a single argument asks for that target's modes`() {
        run("/mode #other", on = "#lobby")
        assertEquals(listOf("send MODE #other"), target.calls)
    }

    @Test
    fun `kick keeps the reason whole and only works in a channel`() {
        run("/kick robin being tiresome", on = "#lobby")
        assertEquals(listOf("kick #lobby robin :being tiresome"), target.calls)

        target.calls.clear()
        assertEquals("/kick only works in a channel", run("/kick robin", on = "robin").error)
        assertTrue(target.calls.isEmpty())
    }

    @Test
    fun `away with no message comes back`() {
        run("/away")
        run("/back")
        assertEquals(listOf("away", "away"), target.calls)
    }

    @Test
    fun `an away message longer than AWAYLEN is refused`() {
        target.state.isupport["AWAYLEN"] = "5"
        assertTrue(run("/away out for lunch").error!!.startsWith("This network allows 5"))
    }

    @Test
    fun `invite defaults to the channel you are in`() {
        run("/invite robin", on = "#lobby")
        assertEquals(listOf("invite robin #lobby"), target.calls)
    }

    @Test
    fun `quit carries the message you gave it`() {
        run("/quit see you")
        assertEquals(listOf("quit :see you"), target.calls)
    }

    @Test
    fun `raw sends the line as typed`() {
        run("/raw WHO #lobby %tcuhnfar")
        assertEquals(listOf("raw WHO #lobby %tcuhnfar"), target.calls)
    }

    @Test
    fun `nick and whois take one argument and complain without it`() {
        run("/nick karaz")
        run("/whois robin")
        assertEquals(listOf("nick karaz", "whois robin"), target.calls)

        target.calls.clear()
        assertEquals("Usage: /nick <nickname>", run("/nick").error)
        assertEquals("Usage: /whois <nick>", run("/whois").error)
    }

    @Test
    fun `msg without a body says what is missing`() {
        assertEquals("Nothing to send to robin", run("/msg robin").error)
        assertTrue(target.calls.isEmpty())
    }

    @Test
    fun `commands are recognised whatever case they are typed in`() {
        run("/JOIN #lobby")
        assertEquals(listOf("join #lobby"), target.calls)
    }
}
