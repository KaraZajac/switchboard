package org.switchboard.android.irc

/**
 * Bytes off the socket, out as whole lines.
 *
 * Separate from the read loop so it can be tested without one. This is the
 * path every byte the client receives takes, and it was written inside a
 * coroutine reading a real socket — where the interesting cases (a line
 * arriving in two pieces, a character split across a read, a line too long to
 * hold) are the ones hardest to arrange and easiest to get wrong. The desktop
 * has had `connection.test.ts` for its equivalent since it had one.
 *
 * Bytes rather than text because an encoding is chosen per line — see
 * [Decoding.line] — and a Reader would have picked one for the whole stream
 * before the first line arrived.
 */
class LineBuffer(private val capacity: Int = MAX_INCOMING) {

    private val pending = ByteArray(capacity)
    private var held = 0

    /**
     * Add what was just read, and take out whatever lines that completed.
     *
     * Blank lines are dropped: a server that sends an empty one means nothing
     * by it, and the parser has nothing to do with it.
     */
    fun feed(bytes: ByteArray, length: Int = bytes.size): List<String> {
        val lines = mutableListOf<String>()

        var offset = 0
        while (offset < length) {
            val room = capacity - held
            if (room == 0) {
                // A line longer than the buffer is not one any server may
                // send. Drop what is held rather than grow — and drop the rest
                // of that line too, or its tail becomes the start of the next.
                held = 0
                discarding = true
                continue
            }

            val take = minOf(room, length - offset)
            System.arraycopy(bytes, offset, pending, held, take)
            held += take
            offset += take

            var from = 0
            while (true) {
                val at = indexOfCrLf(pending, from, held)
                if (at == -1) break

                if (discarding) {
                    // The end of the line we gave up on, not a line of its own
                    discarding = false
                } else {
                    val line = Decoding.line(pending.copyOfRange(from, at))
                    if (line.isNotBlank()) lines.add(line)
                }
                from = at + 2
            }

            if (from > 0) {
                System.arraycopy(pending, from, pending, 0, held - from)
                held -= from
            }
        }

        return lines
    }

    /** True while the rest of an over-long line is being thrown away */
    private var discarding = false

    /** How many bytes are held waiting for the rest of their line */
    val buffered: Int get() = held

    private fun indexOfCrLf(bytes: ByteArray, from: Int, until: Int): Int {
        var at = from
        while (at + 1 < until) {
            if (bytes[at] == 0x0d.toByte() && bytes[at + 1] == 0x0a.toByte()) return at
            at++
        }
        return -1
    }

    companion object {
        /**
         * The most one incoming line can be.
         *
         * Not RFC 1459's 512: `message-tags` allows 8191 bytes of tags in front
         * of it, and a chathistory replay carries most of them — msgid, time,
         * account, batch, and whatever else the network attaches. Sized for the
         * whole of that with room over.
         */
        const val MAX_INCOMING = 16384
    }
}
