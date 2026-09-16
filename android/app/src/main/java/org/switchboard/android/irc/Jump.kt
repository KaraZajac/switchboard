package org.switchboard.android.irc

/**
 * Going to one message, rather than to the room it was said in.
 *
 * The Kotlin half of `src/shared/jump.ts`. Mentions, search results and reply
 * quotes all name a particular line, and all three used to answer with the
 * conversation scrolled to the bottom — the right room, and then you go
 * looking. For a line from this morning that is a scroll; for one from March it
 * is hopeless, because it is not loaded at all and nothing says so.
 *
 * The decision here is only the first one: can this be a scroll, or does
 * something have to be fetched first.
 */
object Jump {

    /** A message as this decision needs to see it */
    data class Placed(val id: String, val timestamp: String)

    /** Where a jump is aimed: an id when there is one, and always a time */
    data class Target(val id: String?, val timestamp: String)

    enum class Plan {
        /** It is already here with room above it — scroll and be done */
        SCROLL,

        /** Fetch around it first */
        LOAD
    }

    /**
     * Whether the loaded conversation can be scrolled to this line as it is.
     *
     * Present is not enough: a message at the very top of what is loaded can be
     * scrolled to and then shows nothing above itself, which is the half of a
     * conversation that explains it. So it also needs [context] lines before it.
     *
     * By id where there is one. A timestamp is a fallback rather than a key:
     * two messages in a busy channel share one to the millisecond often enough,
     * and server clocks are not ours.
     *
     * This answers one question once. A caller that has just fetched scrolls to
     * whatever it got, whether or not the answer here would still be LOAD —
     * otherwise a channel with genuinely nothing older is fetched for ever.
     */
    fun plan(loaded: List<Placed>, target: Target, context: Int = 5): Plan {
        val at = if (target.id != null) {
            loaded.indexOfFirst { it.id == target.id }
        } else {
            loaded.indexOfFirst { it.timestamp == target.timestamp }
        }

        if (at == -1) return Plan.LOAD
        return if (at >= context) Plan.SCROLL else Plan.LOAD
    }
}
