/**
 * Answering the questions other clients ask about this one.
 *
 * CTCP is a question wrapped in `\x01` inside an ordinary message, answered
 * with a NOTICE wrapped the same way. `VERSION` and `SOURCE` are the two
 * anybody actually sends: the first is how a channel finds out what everyone
 * is running, and the second is how somebody finds the code after deciding
 * they like it.
 *
 * Switchboard answered these privately and stayed silent when they were asked
 * of a channel — which is how people ask. Somebody surveying a room got an
 * answer from every client in it except this one, and reported, reasonably,
 * that Switchboard does not respond to CTCP.
 *
 * The silence was not an oversight. A CTCP to a channel is a question put to
 * everybody at once, and a room full of clients each answering it privately is
 * the flood that gave CTCP its reputation. The answer is not to stay quiet, it
 * is to answer at a rate that cannot become a flood — which is what every
 * other client does, and what `CtcpGuard` below is for.
 */

/**
 * What we answer, and what we say we answer.
 *
 * One list, so a person who asks the same question of a desktop, a phone and
 * an always-on instance gets the same reply. `CLIENTINFO` is how the
 * convention says to ask what the rest of the list is, so it names them rather
 * than being one more thing to keep in step by hand.
 */
export const CTCP_ANSWERS = ['CLIENTINFO', 'PING', 'SOURCE', 'TIME', 'VERSION'] as const

export const CTCP_SOURCE_URL = 'https://github.com/KaraZajac/switchboard'

/**
 * The answer to one question, or null for one we do not answer.
 *
 * Everything outside the list goes unanswered, which is the polite reading of
 * the convention — and the safe one, since an unknown verb with a payload is
 * as likely to be somebody probing as somebody asking.
 */
export function ctcpReply(
  verb: string,
  args: string,
  about: { version: string; platform: string; now: Date }
): string | null {
  switch (verb.toUpperCase()) {
    case 'VERSION':
      return `VERSION Switchboard ${about.version} (${about.platform})`
    case 'SOURCE':
      return `SOURCE ${CTCP_SOURCE_URL}`
    case 'CLIENTINFO':
      return `CLIENTINFO ${CTCP_ANSWERS.join(' ')}`
    case 'TIME':
      // To the second, written out rather than left to the runtime's
      // formatter. JavaScript always prints milliseconds and Java omits them
      // when they are zero, so the two clients answered the same question
      // with two different strings — caught by the shared corpus, which is
      // what it is for.
      return `TIME ${about.now.toISOString().replace(/\.\d{3}Z$/, 'Z')}`
    case 'PING':
      // Echoed exactly: the asker is timing the round trip and compares what
      // comes back with what it sent
      return `PING ${args}`
    default:
      return null
  }
}

/**
 * How much answering is reasonable, and over what.
 *
 * One window for both limits, because two windows of different lengths is a
 * rule nobody can hold in their head. Thirty seconds, three answers to any one
 * person, ten to everybody.
 *
 * The per-person number is three rather than one because asking two or three
 * things in a row is what asking looks like: somebody sends `VERSION`, reads
 * it, and sends `SOURCE`. A cooldown of one answer per person silently
 * swallowed the second, which is the same complaint we started with in a
 * smaller form.
 *
 * The overall number is what stops a crowd being used as an amplifier. It is
 * in the same neighbourhood as HexChat's default, which is a number a lot of
 * networks have already put up with.
 */
export const CTCP_WINDOW_MS = 30_000
export const CTCP_PER_ASKER = 3
export const CTCP_TOTAL = 10

/**
 * How often this client is willing to answer.
 *
 * Two limits, because there are two ways an answer becomes a flood. One person
 * asking over and over is held off by the per-person count. A crowd asking at
 * once — which is what a channel full of bots reacting to the same line looks
 * like — is held off by the total, and that one matters more: without it a
 * stranger can make this client send as many messages as they have nicks, and
 * the network kills the client rather than them.
 */
export class CtcpGuard {
  /** When we answered each person, oldest first, by folded nick */
  private readonly answered = new Map<string, number[]>()

  /** When recent answers went out, to anybody */
  private recent: number[] = []

  constructor(
    private readonly windowMs: number = CTCP_WINDOW_MS,
    private readonly perAsker: number = CTCP_PER_ASKER,
    private readonly total: number = CTCP_TOTAL
  ) {}

  /**
   * Whether to answer this one, counting it if so.
   *
   * Asking and recording are one call on purpose: a caller that checks and
   * then forgets to record has no rate limit at all, and nothing about the
   * shape of the code would say so.
   */
  allow(asker: string, now: number): boolean {
    const fresh = (times: number[]): number[] => times.filter((at) => now - at < this.windowMs)

    this.recent = fresh(this.recent)
    if (this.recent.length >= this.total) return false

    const key = asker.toLowerCase()
    const mine = fresh(this.answered.get(key) ?? [])
    if (mine.length >= this.perAsker) {
      this.answered.set(key, mine)
      return false
    }

    mine.push(now)
    this.answered.set(key, mine)
    this.recent.push(now)

    // Kept from growing without limit on a busy network: a person with nothing
    // left inside the window can no longer stop an answer
    if (this.answered.size > 512) {
      for (const [nick, times] of this.answered) {
        if (fresh(times).length === 0) this.answered.delete(nick)
      }
    }

    return true
  }
}
