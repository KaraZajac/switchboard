package org.switchboard.android.irc

/**
 * Whether somebody is reading the past rather than the present.
 *
 * The Kotlin half of `src/shared/present.ts`. Both clients need a way back to
 * the newest message and the question of when to offer one is the same on
 * both: far enough up that scrolling back is a chore, not so eager that it
 * appears every time somebody looks at the line above.
 *
 * Measured in screenfuls, because that is what "a way up" means to the person
 * doing it. A message is three lines or thirty depending on what somebody
 * said, so a count of them describes the scrollbar rather than the journey.
 */
object Present {

    /**
     * How far from the newest message counts as reading the past.
     *
     * One screenful: the point at which the newest line is no longer something
     * you can glance at, and after which getting back means scrolling rather
     * than looking.
     */
    const val SCREENS_BEHIND = 1

    /**
     * @param below how much there is between the bottom of the view and the
     *   end of the conversation, in pixels
     * @param screen the height of the view, in the same pixels
     */
    fun viewingOlder(below: Int, screen: Int): Boolean {
        // A view with no height has not been laid out yet, and everything is
        // at the bottom of nothing. Saying yes there would flash the offer up
        // on every channel switch, before the first frame.
        if (screen <= 0) return false
        if (below <= 0) return false
        return below > screen * SCREENS_BEHIND
    }

    /** The words, kept here so the two clients cannot word it differently */
    const val VIEWING_OLDER = "You're viewing older messages"
    const val JUMP_TO_PRESENT = "Jump to present"
}
