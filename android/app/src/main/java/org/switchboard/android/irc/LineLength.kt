package org.switchboard.android.irc

/**
 * Making a message fit on the wire.
 *
 * An IRC line is 512 bytes, and that budget has to cover the prefix the server
 * puts on our message when it hands it to everyone else — so what we can
 * actually say is 512 minus `:nick!user@host PRIVMSG #channel :` and the CRLF.
 * Go over it and rIRCd answers `417 :Input line was too long` and delivers
 * nothing at all: not truncated, dropped, with no sign of it on the sender's
 * screen.
 *
 * Kept alongside `src/main/irc/features/linelen.ts`, and checked against the
 * same corpus.
 */
object LineLength {

    /** Every line ends with one, and it counts */
    private const val CRLF = 2

    /** RFC 1459, and what every server does absent `LINELEN` in ISUPPORT */
    private const val DEFAULT_LINE_BYTES = 512

    private fun stated(isupport: Map<String, String>, token: String, fallback: Int): Int =
        isupport[token]?.toIntOrNull()?.takeIf { it > 0 } ?: fallback

    /**
     * What the server will prepend to our message on its way out.
     *
     * Known exactly once we have seen our own mask — our own JOIN carries it.
     * Until then it is guessed from ISUPPORT's stated maxima, which overshoots
     * and costs a few characters rather than losing the message.
     */
    private fun prefixBytes(nick: String, userHost: String?, isupport: Map<String, String>): Int =
        if (userHost != null) {
            1 + nick.utf8() + 1 + userHost.utf8() + 1
        } else {
            1 + stated(isupport, "NICKLEN", 32) + 1 +
                stated(isupport, "USERLEN", 32) + 1 +
                stated(isupport, "HOSTLEN", 64) + 1
        }

    /** How many bytes of text will fit in one `<command> <target> :<text>` line */
    fun budget(
        nick: String,
        userHost: String?,
        isupport: Map<String, String>,
        command: String,
        target: String
    ): Int {
        val total = stated(isupport, "LINELEN", DEFAULT_LINE_BYTES)
        val overhead = prefixBytes(nick, userHost, isupport) +
            command.utf8() + 1 + target.utf8() + 2 + CRLF

        // Never so small that splitting cannot terminate. A budget this tight
        // means the guess above is wrong rather than the message being
        // impossible, and one over-long line refused beats an endless loop.
        return maxOf(total - overhead, 32)
    }

    /**
     * Break text into pieces that each fit the budget.
     *
     * Measured in UTF-8 bytes, because that is what the limit is in, and split
     * on whole code points so a piece never ends halfway through a character.
     * Word boundaries are preferred but not required — a single long token has
     * to go somewhere, and cutting it is better than dropping the message.
     */
    fun split(text: String, budget: Int): List<String> {
        if (text.utf8() <= budget) return listOf(text)

        val pieces = mutableListOf<String>()
        var current = StringBuilder()
        var bytes = 0
        var lastSpace = -1

        var at = 0
        while (at < text.length) {
            val point = text.codePointAt(at)
            val char = String(Character.toChars(point))
            at += Character.charCount(point)

            val size = char.utf8()
            if (bytes + size > budget) {
                // Break at the last space if there was one. A run with no space
                // in it has to be cut mid-word, the only case where that is right.
                //
                // The space stays on the end of the piece before it rather than
                // being dropped. Where these go out as a `draft/multiline-concat`
                // batch the receiver joins them with nothing at all, so a space
                // thrown away here is a word joined to the next one on someone
                // else's screen.
                if (lastSpace > 0) {
                    pieces.add(current.substring(0, lastSpace + 1))
                    current = StringBuilder(current.substring(lastSpace + 1))
                    bytes = current.toString().utf8()
                } else {
                    pieces.add(current.toString())
                    current = StringBuilder()
                    bytes = 0
                }
                lastSpace = -1
            }

            if (char == " ") lastSpace = current.length
            current.append(char)
            bytes += size
        }

        if (current.isNotEmpty()) pieces.add(current.toString())
        return pieces
    }

    private fun String.utf8(): Int = toByteArray(Charsets.UTF_8).size
}
