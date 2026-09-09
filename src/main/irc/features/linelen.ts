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
 * Which makes this the same bug as the multiline limits, in the place people
 * hit most often — pasting a paragraph.
 */

/** Every line ends with one, and it counts */
const CRLF = 2

/** RFC 1459, and what every server does absent `LINELEN` in ISUPPORT */
const DEFAULT_LINE_BYTES = 512

/**
 * What the server will prepend to our message on its way out.
 *
 * Known exactly once we have seen our own mask — our own JOIN carries it. Until
 * then it is guessed from ISUPPORT's stated maxima, which overshoots and costs
 * us a few characters rather than losing the message.
 */
function prefixBytes(state: {
  nick: string
  userHost: string | null
  isupport: Record<string, string | true>
}): number {
  if (state.userHost) {
    // ":" + nick + "!" + user@host + " "
    return 1 + Buffer.byteLength(state.nick, 'utf8') + 1 + Buffer.byteLength(state.userHost, 'utf8') + 1
  }

  const stated = (token: string, fallback: number): number => {
    const value = Number(state.isupport[token])
    return Number.isInteger(value) && value > 0 ? value : fallback
  }

  // ":" + nick + "!" + user + "@" + host + " "
  return 1 + stated('NICKLEN', 32) + 1 + stated('USERLEN', 32) + 1 + stated('HOSTLEN', 64) + 1
}

/** How many bytes of text will fit in one `<command> <target> :<text>` line */
export function lineBudget(
  state: {
    nick: string
    userHost: string | null
    isupport: Record<string, string | true>
  },
  command: string,
  target: string
): number {
  const limit = Number(state.isupport['LINELEN'])
  const total = Number.isInteger(limit) && limit > 0 ? limit : DEFAULT_LINE_BYTES

  const overhead =
    prefixBytes(state) +
    Buffer.byteLength(command, 'utf8') +
    1 + // space
    Buffer.byteLength(target, 'utf8') +
    2 + // " :"
    CRLF

  // Never return something so small that splitting cannot terminate. A budget
  // this tight means the guess above is wrong rather than the message being
  // impossible, and one over-long line refused beats an endless loop.
  return Math.max(total - overhead, 32)
}

/**
 * Break text into pieces that each fit the budget.
 *
 * Measured in UTF-8 bytes, because that is what the limit is in, and split on
 * whole code points so a piece never ends halfway through a character. Word
 * boundaries are preferred but not required — a single long token has to go
 * somewhere, and cutting it is better than dropping the message.
 */
export function splitToFit(text: string, budget: number): string[] {
  if (Buffer.byteLength(text, 'utf8') <= budget) return [text]

  const pieces: string[] = []
  let current = ''
  let bytes = 0
  let lastSpace = -1

  for (const char of text) {
    const size = Buffer.byteLength(char, 'utf8')

    if (bytes + size > budget) {
      // Break at the last space if there was one. A run with no space in it
      // has to be cut mid-word, which is the only case where that is right.
      //
      // The space stays on the end of the piece before it rather than being
      // dropped. Where these go out as a `draft/multiline-concat` batch the
      // receiver joins them with nothing at all, so a space thrown away here
      // is a word joined to the next one on someone else's screen.
      if (lastSpace > 0) {
        pieces.push(current.slice(0, lastSpace + 1))
        current = current.slice(lastSpace + 1)
        bytes = Buffer.byteLength(current, 'utf8')
      } else {
        pieces.push(current)
        current = ''
        bytes = 0
      }
      lastSpace = -1
    }

    if (char === ' ') lastSpace = current.length
    current += char
    bytes += size
  }

  if (current.length > 0) pieces.push(current)
  return pieces
}
