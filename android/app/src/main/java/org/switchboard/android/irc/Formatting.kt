package org.switchboard.android.irc

/**
 * mIRC formatting codes, parsed the same way the desktop parses them.
 *
 * The Kotlin half of `src/shared/formatting.ts`, checked against
 * `tests/fixtures/formatting.json`. The phone used to understand four of the
 * nine codes — bold, italic, underline, monospace — and throw the rest away,
 * so a line that arrived in colour with a struck-through word read as two
 * different messages depending on which device you picked up.
 *
 * | byte | meaning                                      |
 * |------|----------------------------------------------|
 * | 0x02 | bold                                         |
 * | 0x03 | colour — `NN` or `NN,NN` from the palette     |
 * | 0x04 | colour — `RRGGBB` or `RRGGBB,RRGGBB` in hex   |
 * | 0x0F | reset everything                             |
 * | 0x11 | monospace                                    |
 * | 0x16 | reverse video                                |
 * | 0x1D | italic                                       |
 * | 0x1E | strikethrough                                |
 * | 0x1F | underline                                    |
 */
object Formatting {

    const val BOLD = '\u0002'
    const val COLOUR = '\u0003'
    const val HEX_COLOUR = '\u0004'
    const val RESET = '\u000F'
    const val MONOSPACE = '\u0011'
    const val REVERSE = '\u0016'
    const val ITALIC = '\u001D'
    const val STRIKETHROUGH = '\u001E'
    const val UNDERLINE = '\u001F'

    /** The classic sixteen, as mIRC has always drawn them */
    private val BASE = listOf(
        "#ffffff", "#000000", "#00007f", "#009300", "#ff0000", "#7f0000", "#9c009c", "#fc7f00",
        "#ffff00", "#00fc00", "#009393", "#00ffff", "#0000fc", "#ff00ff", "#7f7f7f", "#d2d2d2"
    )

    /**
     * The 1999 extension, 16–98.
     *
     * Six bands of twelve hues from near-black to pastel, then eleven greys.
     * Bots reach for these constantly — a feed that colours its source tag `04`
     * and its headline `52` is the normal shape of a busy channel — and a
     * client that only knows the first sixteen draws half the line in the
     * default colour with no sign that anything was meant by it.
     */
    private val EXTENDED = listOf(
        "#470000", "#472100", "#474700", "#324700", "#004700", "#00472c", "#004747", "#002747",
        "#000047", "#2e0047", "#470047", "#47002a",
        "#740000", "#743a00", "#747400", "#517400", "#007400", "#007449", "#007474", "#004074",
        "#000074", "#4b0074", "#740074", "#740045",
        "#b50000", "#b56300", "#b5b500", "#7db500", "#00b500", "#00b571", "#00b5b5", "#0063b5",
        "#0000b5", "#7500b5", "#b500b5", "#b5006b",
        "#ff0000", "#ff8c00", "#ffff00", "#b2ff00", "#00ff00", "#00ffa0", "#00ffff", "#008cff",
        "#0000ff", "#a500ff", "#ff00ff", "#ff0098",
        "#ff5959", "#ffb459", "#ffff71", "#cfff60", "#6fff6f", "#65ffc9", "#6dffff", "#59b4ff",
        "#5959ff", "#c459ff", "#ff66ff", "#ff59bc",
        "#ff9c9c", "#ffd39c", "#ffff9c", "#e2ff9c", "#9cff9c", "#9cffdb", "#9cffff", "#9cd3ff",
        "#9c9cff", "#dc9cff", "#ff9cff", "#ff94d3",
        "#000000", "#131313", "#282828", "#363636", "#4d4d4d", "#656565", "#818181", "#9f9f9f",
        "#bcbcbc", "#e2e2e2", "#ffffff"
    )

    /** The full palette, 0–98. 99 is "whatever the client normally uses". */
    val PALETTE: List<String> = BASE + EXTENDED

    /** A colour code as a hex string, or null for "the default" */
    fun paletteColour(index: Int): String? = PALETTE.getOrNull(index)

    data class Span(
        val text: String,
        val bold: Boolean = false,
        val italic: Boolean = false,
        val underline: Boolean = false,
        val strikethrough: Boolean = false,
        val monospace: Boolean = false,
        /** Reverse video: the renderer swaps foreground and background */
        val reverse: Boolean = false,
        val fg: String? = null,
        val bg: String? = null
    )

    /** Whether a span asks for anything at all */
    fun isPlain(span: Span): Boolean =
        !span.bold && !span.italic && !span.underline && !span.strikethrough &&
            !span.monospace && !span.reverse && span.fg == null && span.bg == null

    private fun Char.isHex(): Boolean =
        this in '0'..'9' || this in 'a'..'f' || this in 'A'..'F'

    /**
     * Split formatted text into runs that share one style.
     *
     * Control bytes never appear in the returned text, so the concatenation of
     * every span is exactly what the reader sees — which is what makes it safe
     * to measure offsets against. Link ranges used to be measured against the
     * unstripped text, and landed several characters early on any coloured line.
     */
    fun parse(text: String): List<Span> {
        val spans = mutableListOf<Span>()
        val run = StringBuilder()
        var bold = false
        var italic = false
        var underline = false
        var strike = false
        var mono = false
        var reverse = false
        var fg: String? = null
        var bg: String? = null
        var i = 0

        fun flush() {
            if (run.isEmpty()) return
            spans.add(Span(run.toString(), bold, italic, underline, strike, mono, reverse, fg, bg))
            run.clear()
        }

        /** Read up to [max] characters from here on that satisfy [want] */
        fun take(max: Int, want: (Char) -> Boolean): String {
            val start = i
            while (i - start < max && i < text.length && want(text[i])) i++
            return text.substring(start, i)
        }

        while (i < text.length) {
            when (text[i]) {
                BOLD -> { flush(); bold = !bold; i++ }
                ITALIC -> { flush(); italic = !italic; i++ }
                UNDERLINE -> { flush(); underline = !underline; i++ }
                STRIKETHROUGH -> { flush(); strike = !strike; i++ }
                MONOSPACE -> { flush(); mono = !mono; i++ }
                REVERSE -> { flush(); reverse = !reverse; i++ }
                RESET -> {
                    flush()
                    bold = false; italic = false; underline = false
                    strike = false; mono = false; reverse = false
                    fg = null; bg = null
                    i++
                }

                COLOUR -> {
                    flush()
                    i++
                    val digits = take(2) { it.isDigit() }
                    if (digits.isEmpty()) {
                        // A bare colour byte closes whatever colour was open
                        fg = null
                        bg = null
                    } else {
                        fg = paletteColour(digits.toInt())
                        // The comma only belongs to us when a digit follows it.
                        // A red "04" followed by ",000 received" is a comma and
                        // a number, not a broken background — eating it
                        // unconditionally deletes a character of the sentence.
                        if (i < text.length && text[i] == ',' &&
                            i + 1 < text.length && text[i + 1].isDigit()
                        ) {
                            i++
                            bg = paletteColour(take(2) { it.isDigit() }.toInt())
                        }
                    }
                }

                HEX_COLOUR -> {
                    flush()
                    i++
                    val hex = take(6) { it.isHex() }
                    if (hex.length < 6) {
                        // Not a colour after all. Anything we consumed was hex
                        // digits, so put them back rather than losing them.
                        fg = null
                        bg = null
                        run.append(hex)
                    } else {
                        fg = "#" + hex.lowercase()
                        if (i < text.length && text[i] == ',' &&
                            i + 1 < text.length && text[i + 1].isHex()
                        ) {
                            val mark = i
                            i++
                            val back = take(6) { it.isHex() }
                            if (back.length == 6) bg = "#" + back.lowercase() else i = mark
                        }
                    }
                }

                else -> { run.append(text[i]); i++ }
            }
        }

        flush()
        return spans
    }

    /**
     * The same text with every control byte removed.
     *
     * Derived from the parser rather than written twice, so the two can never
     * disagree about how much of a malformed colour code was a colour code.
     */
    fun strip(text: String): String = buildString {
        for (span in parse(text)) append(span.text)
    }

    /** How light a colour reads, 0–255. BT.601 weights, integer only. */
    private fun lightness(hex: String): Int {
        val n = hex.substring(1).toInt(16)
        return (77 * ((n shr 16) and 0xff) + 150 * ((n shr 8) and 0xff) + 29 * (n and 0xff)) shr 8
    }

    /** Move a channel [percent] of the way to 255 */
    private fun lift(channel: Int, percent: Int): Int =
        (channel * (100 - percent) + 255 * percent + 50) / 100

    /**
     * The darkest a colour may be before it disappears into the window.
     *
     * mIRC's palette was chosen against white. Both clients are dark, so
     * colour 1 is black text on a near-black background — invisible, and worse
     * than not colouring it at all, because the reader cannot tell there was
     * ever anything there. This is why the phone stripped colours instead of
     * drawing them; now both sides lift the few that need it and keep the rest.
     *
     * Only applies when the sender did not also pick a background: if they
     * chose the pair, they chose it, and we draw what they asked for.
     */
    fun readableOnDark(fg: String?, bg: String?): String? {
        if (fg == null || bg != null) return fg
        if (lightness(fg) >= 64) return fg
        val n = fg.substring(1).toInt(16)
        return "#%02x%02x%02x".format(
            lift((n shr 16) and 0xff, 45),
            lift((n shr 8) and 0xff, 45),
            lift(n and 0xff, 45)
        )
    }
}
