package org.switchboard.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.switchboard.android.irc.LineBuffer

/**
 * Bytes off the socket, out as whole lines.
 *
 * This is the path every byte the client receives takes, and it lived inside a
 * coroutine reading a real socket — where the cases that matter (a line
 * arriving in two pieces, a character split across a read, a line too long to
 * hold) are the hardest to arrange and the easiest to get wrong. The desktop
 * has had `connection.test.ts` for its equivalent since it had one; this is
 * the phone's.
 */
class LineBufferTest {

    private fun bytes(text: String) = text.toByteArray(Charsets.UTF_8)

    @Test
    fun `one line in one read`() {
        val buffer = LineBuffer()
        assertEquals(listOf("PING :abc"), buffer.feed(bytes("PING :abc\r\n")))
        assertEquals(0, buffer.buffered)
    }

    @Test
    fun `several lines in one read, in order`() {
        val buffer = LineBuffer()
        assertEquals(
            listOf("ONE", "TWO", "THREE"),
            buffer.feed(bytes("ONE\r\nTWO\r\nTHREE\r\n"))
        )
    }

    @Test
    fun `a line split across two reads`() {
        val buffer = LineBuffer()

        assertEquals(emptyList<String>(), buffer.feed(bytes("PRIVMSG #c :half")))
        assertTrue("the half line is held, not dropped", buffer.buffered > 0)
        assertEquals(listOf("PRIVMSG #c :half a line"), buffer.feed(bytes(" a line\r\n")))
    }

    @Test
    fun `a CRLF split across two reads`() {
        val buffer = LineBuffer()

        // The cruellest split there is: the terminator itself in two pieces
        assertEquals(emptyList<String>(), buffer.feed(bytes("PING :abc\r")))
        assertEquals(listOf("PING :abc"), buffer.feed(bytes("\nNEXT\r\n").copyOfRange(0, 1)))
    }

    @Test
    fun `a multi-byte character split across two reads`() {
        val buffer = LineBuffer()
        val line = bytes("PRIVMSG #c :café\r\n")
        val cut = line.indexOf(0xc3.toByte()) + 1

        assertEquals(emptyList<String>(), buffer.feed(line.copyOfRange(0, cut)))
        // Decoded per line rather than per read, so the two halves of é meet
        assertEquals(
            listOf("PRIVMSG #c :café"),
            buffer.feed(line.copyOfRange(cut, line.size))
        )
    }

    @Test
    fun `a line that is not UTF-8 comes back as the text it meant`() {
        val buffer = LineBuffer()
        val line = bytes("PRIVMSG #c :caf") + byteArrayOf(0xe9.toByte()) + bytes("\r\n")

        assertEquals(listOf("PRIVMSG #c :café"), buffer.feed(line))
    }

    @Test
    fun `blank lines are dropped`() {
        val buffer = LineBuffer()
        assertEquals(listOf("ONE", "TWO"), buffer.feed(bytes("ONE\r\n\r\n   \r\nTWO\r\n")))
    }

    @Test
    fun `a line too long to hold is dropped without taking the next one with it`() {
        val buffer = LineBuffer(capacity = 64)

        val monstrous = bytes("x".repeat(200) + "\r\n")
        buffer.feed(monstrous)

        // The tail of the line we gave up on must not become the head of the
        // next one — which is what makes dropping half a line worse than
        // dropping all of it
        assertEquals(listOf("PING :fine"), buffer.feed(bytes("PING :fine\r\n")))
    }

    @Test
    fun `holds a line as long as message-tags allows`() {
        val buffer = LineBuffer()

        // 8191 bytes of tags is what the spec permits in front of the line, and
        // a chathistory replay carries most of them
        val tags = "@" + "a=b;".repeat(2000)
        val line = "$tags :n!u@h PRIVMSG #c :hello"
        assertEquals(listOf(line), buffer.feed(bytes(line + "\r\n")))
    }

    @Test
    fun `a read that is only part of a buffer is respected`() {
        val buffer = LineBuffer()
        val chunk = bytes("ONE\r\nTWO\r\nrubbish that was not read")

        // `length` is what the socket actually returned; anything past it is
        // whatever the array held last time round
        assertEquals(listOf("ONE", "TWO"), buffer.feed(chunk, "ONE\r\nTWO\r\n".length))
    }
}
