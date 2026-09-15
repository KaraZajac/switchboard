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
    private const val ZWJ = 0x200D

    /** The five Fitzpatrick modifiers */
    private fun skinTone(cp: Int) = cp in 0x1F3FB..0x1F3FF

    /** One half of a flag; two of them in a row are one flag */
    private fun regional(cp: Int) = cp in 0x1F1E6..0x1F1FF

    /** Something that decorates the thing before it rather than standing alone */
    private fun extends(cp: Int): Boolean {
        if (cp == 0xFE0F || cp == 0xFE0E || cp == 0x20E3) return true
        return when (Character.getType(cp)) {
            Character.NON_SPACING_MARK.toInt(),
            Character.COMBINING_SPACING_MARK.toInt(),
            Character.ENCLOSING_MARK.toInt() -> true
            else -> false
        }
    }

    /**
     * The smallest thing a line may be cut between.
     *
     * Not a character: a flag is two code points, a skin tone is two, and a
     * family is seven with the joins in between. Cutting between any of them
     * leaves half an emoji at the end of one message and a stray modifier at
     * the start of the next — a thumbs-up arrives as a thumb and a coloured
     * square.
     *
     * Worked out here rather than asked of `BreakIterator`, which was what
     * this used to do. Its answer depends on the Unicode data the runtime
     * happens to carry: the same thumbs-up stayed whole on one JVM and came
     * apart on another, and on Android that data changes with the API level —
     * so the phone would have cut emoji in half on some devices and not
     * others, and no test on one machine would ever have shown it. The
     * desktop's `Intl.Segmenter` is a real implementation of the Unicode
     * rules; this covers the same joins, and `tests/fixtures/multiline.json`
     * holds both to the same answers.
     */
    private fun graphemes(text: String): List<String> {
        if (text.isEmpty()) return emptyList()

        val out = mutableListOf<String>()
        var current = StringBuilder()
        var previous = -1
        // How many flag halves the cluster already holds: a third one starts a
        // new flag rather than joining the pair
        var regionals = 0

        var i = 0
        while (i < text.length) {
            val cp = text.codePointAt(i)

            val joins = when {
                current.isEmpty() -> true
                // A zero-width joiner binds what is on either side of it
                previous == ZWJ || cp == ZWJ -> true
                extends(cp) || skinTone(cp) -> true
                regional(cp) && regionals == 1 -> true
                else -> false
            }

            if (!joins) {
                out.add(current.toString())
                current = StringBuilder()
                regionals = 0
            }

            current.appendCodePoint(cp)
            regionals = if (regional(cp)) regionals + 1 else 0
            previous = cp
            i += Character.charCount(cp)
        }

        out.add(current.toString())
        return out
    }

    fun split(text: String, budget: Int): List<String> {
        if (text.utf8() <= budget) return listOf(text)

        val pieces = mutableListOf<String>()
        var current = StringBuilder()
        var bytes = 0
        var lastSpace = -1

        for (char in graphemes(text)) {
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
                } else if (current.isNotEmpty()) {
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
