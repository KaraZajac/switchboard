/**
 * When to tell a channel that somebody is typing.
 *
 * `+typing` is a client tag on a TAGMSG: `active` while a message is being
 * written, `done` when it is sent or the box is emptied. The spec's only hard
 * rule is the rate — one `active` per three seconds at most — and the rest is
 * left to the client, which is how the two of ours ended up disagreeing.
 *
 * The desktop sent `active` on a keystroke and went quiet when the typing
 * stopped, which is right: a receiver stops showing the notice after six
 * seconds without one, so silence says "stopped" without spending a line on
 * it. The phone ran a loop instead — `active` every three seconds for as long
 * as there was anything in the box. Put a half-written message down and walk
 * away and it went on telling the channel you were typing, forever. On the
 * wire, from a phone that was touched once and then left alone:
 *
 *     23:48:50  +typing=active
 *     23:48:53  +typing=active
 *     23:48:56  +typing=active
 *
 * And on send it announced `done` twice — once from the send itself and once
 * from the box becoming empty — which is two lines of somebody's flood
 * allowance for one message:
 *
 *     23:48:57.587  +typing=done
 *     23:48:57.587  +typing=done
 *
 * One rule now, holding the same small piece of state on both: when the last
 * `active` went out, and 0 for "nothing to take back".
 */

import { TYPING_THROTTLE_MS } from './constants'

/** What just happened in the composer */
export type TypingEvent =
  /** A keystroke, with something left in the box */
  | 'typed'
  /** The box became empty without anything being sent */
  | 'cleared'
  /** The message went */
  | 'sent'

export interface TypingDecision {
  /** What to put on the wire, or null for nothing — which is most keystrokes */
  send: 'active' | 'done' | null
  /** The state to hold until the next event */
  lastActiveAt: number
}

/**
 * Whether this event is worth a line, given what was last said.
 *
 * `done` only where an `active` is outstanding. Announcing that you have
 * stopped doing a thing you never said you were doing is noise, and on a
 * network that counts lines it is noise with a cost.
 */
export function typingToSend(
  event: TypingEvent,
  lastActiveAt: number,
  now: number
): TypingDecision {
  if (event === 'typed') {
    // 0 is "nothing outstanding" rather than a moment, so the throttle has
    // nothing to measure from and the first keystroke always speaks.
    if (lastActiveAt === 0) return { send: 'active', lastActiveAt: now }
    if (now - lastActiveAt <= TYPING_THROTTLE_MS) return { send: null, lastActiveAt }
    return { send: 'active', lastActiveAt: now }
  }

  if (lastActiveAt === 0) return { send: null, lastActiveAt: 0 }
  return { send: 'done', lastActiveAt: 0 }
}
