/**
 * Turning the bytes on the wire into text.
 *
 * IRC never agreed on an encoding. UTF-8 won everywhere it was allowed to, and
 * on Libera or Ergo nothing else turns up — but EFnet and IRCnet have no
 * `UTF8ONLY` to enforce it and never will, and the people on them have been
 * sending Latin-1 since before UTF-8 existed. Both clients decoded strictly as
 * UTF-8, so those lines arrived as a row of replacement characters: `café`
 * became `caf<?>`, and nothing told the reader whether the sender had typed
 * nonsense or the client had made some.
 *
 * So: UTF-8 when the line is valid UTF-8, which is almost always and is what
 * the modern networks guarantee, and Windows-1252 when it is not. Not
 * ISO-8859-1 — the bytes 0x80–0x9F are unassigned there and are exactly the
 * ones an old Windows client uses for curly quotes and dashes, which is most of
 * what actually turns up.
 *
 * Each line is decoded on its own, because the choice belongs to whoever sent
 * it and two people in a channel can disagree.
 *
 * The validity check is the platform's own decoder in strict mode rather than
 * anything written here: UTF-8 has overlong forms, surrogate halves and
 * truncated tails to rule out, and a hand-rolled check that gets one of them
 * wrong is how decoders become exploits.
 */

/** Rejects anything that is not valid UTF-8, rather than substituting for it */
const strictUtf8 = new TextDecoder('utf-8', { fatal: true })

/** The 0x80–0x9F range, which is where Windows-1252 differs from ISO-8859-1 */
const CP1252_HIGH = [
  0x20ac, 0x0081, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021,
  0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x008d, 0x017d, 0x008f,
  0x0090, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014,
  0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x009d, 0x017e, 0x0178
]

/** One line of wire bytes, as the text it was meant to be */
export function decodeLine(bytes: Uint8Array): string {
  try {
    return strictUtf8.decode(bytes)
  } catch {
    let out = ''
    for (const byte of bytes) {
      out += byte >= 0x80 && byte <= 0x9f
        ? String.fromCharCode(CP1252_HIGH[byte - 0x80])
        : String.fromCharCode(byte)
    }
    return out
  }
}
