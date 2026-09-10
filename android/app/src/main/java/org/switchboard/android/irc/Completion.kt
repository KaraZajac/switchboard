package org.switchboard.android.irc

/**
 * Finishing a half-typed name.
 *
 * The Kotlin half of `src/shared/completion.ts`, checked against
 * `tests/fixtures/completion.json`. The two clients complete differently on
 * purpose — the desktop cycles with Tab, this one offers a row to tap, and a
 * touchscreen has no Tab key. What they should not differ on is the answer.
 *
 * They did: this put a colon after anything completed at the start of a line,
 * including a channel, so tapping `#switchboard` gave `#switchboard: ` — which
 * reads as addressing a person who is not there.
 */
object Completion {

    /**
     * Who or what matches what has been typed so far.
     *
     * Two characters before offering anything: one letter matches most of a
     * busy channel, and a row of forty names is not a suggestion.
     */
    fun matching(partial: String, candidates: List<String>, limit: Int = 6): List<String> {
        if (partial.length < 2) return emptyList()

        val wanted = partial.lowercase()
        return candidates
            .filter { it.lowercase().startsWith(wanted) && !it.equals(partial, ignoreCase = true) }
            .sortedBy { it.lowercase() }
            .take(limit)
    }

    /**
     * What goes after a completed word.
     *
     * `robin: ` at the start of a line and `robin ` anywhere else — the
     * convention every IRC client follows. A command or a channel never takes
     * the colon: `/join: ` is not a command and `#switchboard: ` is not
     * addressing anybody.
     */
    fun suffix(atStartOfLine: Boolean, completion: String): String = when {
        !atStartOfLine -> " "
        completion.startsWith("/") || completion.startsWith("#") -> " "
        else -> ": "
    }

    /** The draft with the half-typed word replaced by the whole one */
    fun complete(draft: String, completion: String): String {
        val head = draft.substring(0, draft.lastIndexOf(' ') + 1)
        return head + completion + suffix(head.isEmpty(), completion)
    }
}
