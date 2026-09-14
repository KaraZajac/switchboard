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

    /**
     * A mention being typed.
     *
     * Suggestions used to appear for any two letters typed, which meant a
     * box popping up over the keyboard while somebody typed "bu" on the way
     * to "but". Now the `@` is the intent: `@` alone offers everyone here,
     * `@b` narrows to the b's. An `@` inside a word — an email — is not one.
     */
    private val MENTION = Regex("(?:^|\\s)@([^\\s@]*)$")

    /** The name after a trailing `@`, or null when nothing is being mentioned */
    fun mentionQuery(draft: String): String? = MENTION.find(draft)?.groupValues?.get(1)

    /**
     * Who matches a mention so far. Any length, unlike Tab completion: the
     * `@` already said what was meant. A name typed out in full still shows.
     */
    fun mentionCandidates(query: String, people: List<String>, limit: Int = 10): List<String> {
        val wanted = query.lowercase()
        return people
            .filter { it.lowercase().startsWith(wanted) }
            .sortedBy { it.lowercase() }
            .take(limit)
    }

    /**
     * The draft with the mention finished: what followed the `@` replaced by
     * the name as the channel spells it, and a space to go on typing.
     *
     * The `@` stays. It is what was typed, it is how Discord and Slack write
     * a mention, and a nick is still a nick to the other side's highlighter
     * with an `@` in front of it — `@` is not a character a nick can contain.
     */
    fun mentioned(draft: String, nick: String): String {
        val match = MENTION.find(draft) ?: return draft
        val at = match.range.first + if (match.value.startsWith("@")) 0 else 1
        return draft.substring(0, at) + "@" + nick + " "
    }
}
