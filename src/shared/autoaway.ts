/**
 * Going away when nobody is there, and coming back when they are.
 *
 * Without this, an away message is only ever the one you last set by hand —
 * which for most people is none, so the network says you are at the keyboard at
 * four in the morning and nobody understands why you are not answering.
 *
 * The two clients measure "nobody is there" differently and have to: the
 * desktop asks the operating system how long since any input anywhere, and a
 * phone has no such clock, so it counts from the moment the screen went dark.
 * Both produce seconds of nothing, and everything after that — how long is long
 * enough, whose away message may be replaced, when to take one back — is the
 * same decision and is made here.
 *
 * The rule that matters is the last one. An away message somebody typed says
 * something this feature does not know, and clearing it because a mouse moved
 * tells the channel they are back from a lunch they are still at.
 */

/** What should happen to one connection */
export type AwayAction =
  /** Mark away */
  | 'set'
  /** Take back the away this feature set */
  | 'clear'
  /** Leave it exactly as it is */
  | 'nothing'

export interface AwayNow {
  /** Seconds since anything happened on this device */
  idleSeconds: number
  /** Minutes of nothing that counts as away. Zero or less turns it off. */
  afterMinutes: number
  /** Whether the network already thinks we are away */
  alreadyAway: boolean
  /** Whether it was this feature that said so */
  setByUs: boolean
}

/** What an away with nothing behind it says */
export const DEFAULT_AWAY_MESSAGE = 'Away from the keyboard'

/**
 * One look at the clock, for one connection.
 *
 * Turning the feature off does not leave an away hanging: anything this set is
 * taken back on the next look, which is what somebody who just switched it off
 * means by switching it off.
 */
export function awayAction(now: AwayNow): AwayAction {
  // A missing setting read as a number is zero, and "after zero minutes" would
  // mark somebody away the instant they connected — so the absence of a
  // setting has to mean off, not immediately.
  const on = Number.isFinite(now.afterMinutes) && now.afterMinutes > 0
  const idle = Number.isFinite(now.idleSeconds) ? now.idleSeconds : 0

  if (on && idle >= now.afterMinutes * 60) {
    if (now.setByUs) return 'nothing'
    // Never over the top of one somebody set themselves.
    return now.alreadyAway ? 'nothing' : 'set'
  }

  return now.setByUs ? 'clear' : 'nothing'
}

/** What to say, with the ordinary sentence standing in for an empty box */
export function awayMessage(configured: string | null | undefined): string {
  const typed = (configured ?? '').trim()
  return typed.length > 0 ? typed : DEFAULT_AWAY_MESSAGE
}
