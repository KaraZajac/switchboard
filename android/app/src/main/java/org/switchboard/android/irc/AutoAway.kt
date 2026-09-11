package org.switchboard.android.irc

/**
 * Going away when nobody is there, and coming back when they are.
 *
 * The Kotlin half of `src/shared/autoaway.ts`, checked against
 * `tests/fixtures/autoaway.json`.
 *
 * The two clients measure "nobody is there" differently and have to: the
 * desktop asks the operating system how long since any input anywhere, and a
 * phone has no such clock, so it counts from the moment the screen went dark.
 * Both produce seconds of nothing, and everything after that — how long is
 * long enough, whose away message may be replaced, when to take one back — is
 * the same decision and is made here.
 *
 * The rule that matters is the last one. An away message somebody typed says
 * something this feature does not know, and clearing it because the screen lit
 * up tells the channel they are back from a lunch they are still at.
 */
object AutoAway {

    /** What should happen to one connection */
    enum class Action {
        /** Mark away */
        SET,

        /** Take back the away this feature set */
        CLEAR,

        /** Leave it exactly as it is */
        NOTHING
    }

    /** What an away with nothing behind it says */
    const val DEFAULT_MESSAGE = "Away from the keyboard"

    /**
     * One look at the clock, for one connection.
     *
     * @param idleSeconds seconds since anything happened on this device
     * @param afterMinutes minutes of nothing that counts as away; zero or less
     *   turns it off
     * @param alreadyAway whether the network already thinks we are away
     * @param setByUs whether it was this feature that said so
     *
     * Turning the feature off does not leave an away hanging: anything this set
     * is taken back on the next look, which is what somebody who just switched
     * it off means by switching it off.
     */
    fun action(
        idleSeconds: Long,
        afterMinutes: Int,
        alreadyAway: Boolean,
        setByUs: Boolean
    ): Action {
        // A missing setting read as a number is zero, and "after zero minutes"
        // would mark somebody away the instant they connected — so the absence
        // of a setting has to mean off, not immediately.
        val on = afterMinutes > 0
        val idle = if (idleSeconds > 0) idleSeconds else 0

        if (on && idle >= afterMinutes.toLong() * 60) {
            if (setByUs) return Action.NOTHING
            // Never over the top of one somebody set themselves.
            return if (alreadyAway) Action.NOTHING else Action.SET
        }

        return if (setByUs) Action.CLEAR else Action.NOTHING
    }

    /** What to say, with the ordinary sentence standing in for an empty box */
    fun message(configured: String?): String {
        val typed = configured.orEmpty().trim()
        return if (typed.isNotEmpty()) typed else DEFAULT_MESSAGE
    }
}
