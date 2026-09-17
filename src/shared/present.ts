/**
 * Whether somebody is reading the past rather than the present.
 *
 * Both clients need a way back to the newest message, and the question of when
 * to offer one is the same question on both: far enough up that scrolling back
 * is a chore, not so eager that it appears every time somebody looks at the
 * line above.
 *
 * The desktop offered it at a hundred pixels — about one line — so it was
 * there almost any time the view was not pinned to the bottom, which makes it
 * furniture rather than an offer. The phone did not offer it at all.
 *
 * Measured in screenfuls, because that is what "a way up" means to the person
 * doing it: a message is three lines or thirty depending on what somebody
 * said, and a count of them describes the scrollbar rather than the journey.
 */

/**
 * How far from the newest message counts as reading the past.
 *
 * One screenful. That is the point at which the newest line is no longer
 * somewhere you can glance at, and the point after which getting back means
 * scrolling rather than looking — which is the whole reason for a button.
 */
export const SCREENS_BEHIND = 1

/**
 * @param below how much there is between the bottom of the view and the end of
 *   the conversation, in pixels
 * @param screen the height of the view, in the same pixels
 */
export function viewingOlder(below: number, screen: number): boolean {
  // A view with no height has not been laid out yet, and everything is at the
  // bottom of nothing. Saying "yes" there would flash the offer up on every
  // channel switch, before the first paint.
  if (screen <= 0) return false
  if (below <= 0) return false
  return below > screen * SCREENS_BEHIND
}

/** The words, kept here so the two clients cannot word it differently */
export const VIEWING_OLDER = "You're viewing older messages"
export const JUMP_TO_PRESENT = 'Jump to present'
