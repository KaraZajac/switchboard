package org.switchboard.android.irc

/**
 * The lines you have already sent, and getting one back.
 *
 * The Kotlin half of `src/shared/history.ts`, checked against
 * `tests/fixtures/history.json`.
 *
 * Kept in memory and never written down. People type `/msg NickServ IDENTIFY`
 * into a composer, and a history file is a credential on disk; a history that
 * ends when the app does is the same trade every shell makes with `HISTFILE`
 * unset, and the one a chat client should default to.
 *
 * Per conversation, because recalling what you said in one channel while
 * typing in another is a way to say it in the wrong room.
 */
object History {

    /**
     * @param lines what has been sent, newest first
     * @param at where we are: -1 is the half-typed line, 0 is the newest sent
     * @param draft what was in the box before Up was pressed
     */
    data class State(
        val lines: List<String> = emptyList(),
        val at: Int = -1,
        val draft: String = ""
    )

    /**
     * How many lines to keep.
     *
     * Enough to find the thing you sent a few minutes ago and not so many that
     * the list is a transcript. The desktop keeps the same number.
     */
    const val LIMIT = 100

    /**
     * Note a line that was sent.
     *
     * Blank lines are not history. Nor is the same line twice in a row —
     * sending `yes` three times should not need three presses of Up to get
     * past, which is the rule every shell uses and the one people expect.
     */
    fun remember(state: State, line: String): State {
        if (line.isBlank()) return state.copy(at = -1, draft = "")
        if (state.lines.firstOrNull() == line) return state.copy(at = -1, draft = "")

        return State(lines = (listOf(line) + state.lines).take(LIMIT), at = -1, draft = "")
    }

    /**
     * Up: one line further back.
     *
     * [current] is what is in the box, kept so that coming back down returns
     * the half-written line rather than an empty box — which is the difference
     * between a history that helps and one people learn not to touch.
     */
    fun older(state: State, current: String): State {
        // Nothing to recall: keep what is in the box so reading the text back
        // gives the same line, and leave the position alone so the key falls
        // through and moves the caret the way it otherwise would.
        if (state.lines.isEmpty()) return state.copy(draft = current)

        if (state.at == -1) return state.copy(at = 0, draft = current)

        // At the oldest it stays there. Wrapping round to the newest looks
        // like the same key doing two different things.
        return state.copy(at = minOf(state.at + 1, state.lines.size - 1))
    }

    /** Down: one line forward, and past the newest is the line you were writing */
    fun newer(state: State): State =
        if (state.at == -1) state else state.copy(at = state.at - 1)

    /** What the box should show */
    fun textOf(state: State): String =
        if (state.at == -1) state.draft else state.lines.getOrNull(state.at) ?: state.draft

    /** Whether Up or Down would do anything, so the key can fall through */
    fun browsing(state: State): Boolean = state.at != -1
}
