package org.switchboard.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test
import org.switchboard.android.irc.Irc

/**
 * draft/oper-tag, on the phone.
 *
 * Someone claiming to be network staff in a DM is a common enough trick that
 * being able to tell is the whole point: this is the server saying it, and a
 * nick cannot. So the distinction that matters is between "the server says
 * yes" and "the server did not say" — never between yes and a missing name.
 */
class OperTagTest {

    private fun operOf(raw: String): String? {
        val message = Irc.parse(raw)
        return if (message.hasTag("draft/oper")) message.tag("draft/oper").orEmpty() else null
    }

    @Test
    fun `gives the name when the server names one`() {
        assertEquals("kara", operOf("@draft/oper=kara :k!u@h PRIVMSG #lounge :hello"))
    }

    /** A valueless tag is still a yes, and must not read as an absence */
    @Test
    fun `is still a yes with no name on it`() {
        val oper = operOf("@draft/oper :k!u@h PRIVMSG #lounge :hello")
        assertNotNull(oper)
        assertEquals("", oper)
    }

    @Test
    fun `is nothing at all when the tag is absent`() {
        assertNull(operOf(":k!u@h PRIVMSG #lounge :hello"))
        assertNull(operOf("@account=kara;msgid=x :k!u@h PRIVMSG #lounge :hello"))
    }

    /** The client tag is a different tag, and anyone can send one */
    @Test
    fun `does not take a client tag for the server saying so`() {
        assertNull(operOf("@+draft/oper=liar :k!u@h PRIVMSG #lounge :hello"))
    }
}
