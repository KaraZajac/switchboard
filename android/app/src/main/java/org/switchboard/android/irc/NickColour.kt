package org.switchboard.android.irc

/**
 * The colour a person is, and the colour their initial is written in.
 *
 * Deterministic from the nick, so the same person is the same colour in every
 * channel, on every network, on both clients and under every theme. That last
 * one was not quite true: the desktop named these as Tailwind classes, two of
 * the seventeen were shades every palette redefines, and so two people in
 * seventeen changed colour when you changed theme — and this file's ancestor
 * copied the accident out of `Palettes.kt` to stay in step. They are written
 * out here now, once, which is what both clients meant all along.
 *
 * The lettering matters more than it sounds. The desktop wrote every initial
 * in white, which on the mint green a Catppuccin palette gave that slot was
 * 2.01:1 — a letter you cannot read. The phone wrote them in the theme's
 * darkest surface, dark on twelve themes and light on the thirteenth, so it
 * failed the other way round. Neither could be right, because the circle does
 * not change with the theme and the ink was being chosen as though it did.
 *
 * So the ink is chosen from the circle: whichever of black and white stands
 * out more against it. The worst case over all seventeen is 4.63:1.
 *
 * Kept alongside `src/shared/nickcolour.ts`, and checked against the same
 * corpus.
 */
object NickColour {

    /**
     * Tailwind's own `-600` shades, written out rather than named.
     *
     * Seventeen, one per hue, in the order the hash indexes them — changing the
     * order or the length repaints everybody, so don't.
     */
    val COLOURS = listOf(
        0xFFE7000B, // red
        0xFFF54900, // orange
        0xFFE17100, // amber
        0xFFD08700, // yellow
        0xFF5EA500, // lime
        0xFF00A63E, // green
        0xFF009966, // emerald
        0xFF009689, // teal
        0xFF0092B8, // cyan
        0xFF0084D1, // sky
        0xFF155DFC, // blue
        0xFF4F39F6, // indigo
        0xFF7F22FE, // violet
        0xFF9810FA, // purple
        0xFFC800DE, // fuchsia
        0xFFE60076, // pink
        0xFFEC003F  // rose
    )

    /** Black or white, whichever stands out more against this colour */
    fun ink(argb: Long): Long {
        val light = contrast(1.0, luminance(argb))
        val dark = contrast(0.0, luminance(argb))
        return if (light >= dark) 0xFFFFFFFF else 0xFF000000
    }

    /**
     * The colour for a nick.
     *
     * FNV-1a, for the spread it gives over short strings — a channel of `dave`,
     * `dave_` and `dave__` should not be three of the same circle. The desktop
     * computes this in 32-bit two's complement and takes the absolute value;
     * the same arithmetic, spelled for Kotlin, is what keeps the two agreeing.
     */
    fun of(nick: String): Long {
        var hash = 2166136261L
        for (char in nick) {
            hash = hash xor char.code.toLong()
            hash = (hash * 16777619L) and 0xFFFFFFFFL
        }
        val index = if (nick.isEmpty()) {
            hash % COLOURS.size
        } else {
            val signed = if (hash >= 0x80000000L) hash - 0x100000000L else hash
            kotlin.math.abs(signed) % COLOURS.size
        }
        return COLOURS[index.toInt()]
    }

    private fun luminance(argb: Long): Double {
        fun channel(shift: Int): Double {
            val value = ((argb shr shift) and 0xFF).toDouble() / 255.0
            return if (value <= 0.03928) value / 12.92
            else Math.pow((value + 0.055) / 1.055, 2.4)
        }
        return 0.2126 * channel(16) + 0.7152 * channel(8) + 0.0722 * channel(0)
    }

    private fun contrast(a: Double, b: Double): Double =
        (maxOf(a, b) + 0.05) / (minOf(a, b) + 0.05)
}
