package org.switchboard.android.irc

import java.nio.ByteBuffer
import java.nio.charset.CharacterCodingException
import java.nio.charset.CodingErrorAction
import java.nio.charset.StandardCharsets

/**
 * Turning the bytes on the wire into text.
 *
 * The Kotlin half of `src/shared/decoding.ts`, checked against
 * `tests/fixtures/decoding.json`. IRC never agreed on an encoding: UTF-8 won
 * wherever it was allowed to, but EFnet and IRCnet have no `UTF8ONLY` to
 * enforce it and never will, and the people on them have been sending Latin-1
 * since before UTF-8 existed. Decoded strictly as UTF-8 those lines arrived as
 * a row of replacement characters, with nothing to say whose fault it was.
 *
 * So: UTF-8 when the line is valid UTF-8, and Windows-1252 when it is not. Not
 * ISO-8859-1 — the bytes 0x80–0x9F are unassigned there and are exactly the
 * ones an old Windows client uses for curly quotes and dashes.
 *
 * The validity check is the platform's own decoder in strict mode rather than
 * anything written here: UTF-8 has overlong forms, surrogate halves and
 * truncated tails to rule out, and a hand-rolled check that gets one of them
 * wrong is how decoders become exploits.
 */
object Decoding {

    /** The 0x80–0x9F range, where Windows-1252 differs from ISO-8859-1 */
    private val CP1252_HIGH = intArrayOf(
        0x20ac, 0x0081, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021,
        0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x008d, 0x017d, 0x008f,
        0x0090, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014,
        0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x009d, 0x017e, 0x0178
    )

    /** One line of wire bytes, as the text it was meant to be */
    fun line(bytes: ByteArray, length: Int = bytes.size): String {
        val decoder = StandardCharsets.UTF_8.newDecoder()
            .onMalformedInput(CodingErrorAction.REPORT)
            .onUnmappableCharacter(CodingErrorAction.REPORT)

        return try {
            decoder.decode(ByteBuffer.wrap(bytes, 0, length)).toString()
        } catch (e: CharacterCodingException) {
            buildString(length) {
                for (index in 0 until length) {
                    val byte = bytes[index].toInt() and 0xff
                    append(
                        if (byte in 0x80..0x9f) CP1252_HIGH[byte - 0x80].toChar()
                        else byte.toChar()
                    )
                }
            }
        }
    }
}
