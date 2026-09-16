package org.switchboard.android.irc

/**
 * Where a conversation has been read up to.
 *
 * `draft/read-marker` is the thing that stops catching up in bed and still
 * finding forty unread in the morning: the position is the network's, not the
 * device's, and every device pushes its own forward and hears about everyone
 * else's.
 *
 * Which is why it only ever moves forward. A marker arrives from at least
 * three directions — this device reading, this device's own stored copy read
 * back at startup, and the server echoing somebody else's `MARKREAD` — and
 * they do not arrive in order. Whichever landed last used to win on the
 * desktop, so reading a channel and having the startup load finish a moment
 * later made the lines just read unread again.
 *
 * Kept alongside `src/shared/readmarker.ts`, and checked against the same
 * corpus.
 */
object ReadMarker {

    /**
     * The further of two positions, or null when there is no usable one.
     *
     * Compared as text, which for ISO-8601 in UTC is the same as comparing the
     * instants and is what [Unread] already does.
     */
    fun furthest(known: String?, arriving: String?): String? {
        val from = position(known)
        val to = position(arriving)

        if (from == null) return to
        if (to == null) return from
        return if (to > from) to else from
    }

    /** Whether a marker should be written down at all */
    fun movesForward(known: String?, arriving: String?): Boolean {
        val to = position(arriving) ?: return false
        val from = position(known)
        return from == null || to > from
    }

    /**
     * A timestamp, or null for the ways a server says it has none.
     *
     * `MARKREAD <target> *` is the answer to asking about a conversation
     * nobody has marked yet. Reading the `*` as a position would sort above
     * every real timestamp and mark the whole conversation read.
     */
    private fun position(value: String?): String? {
        val trimmed = value?.trim() ?: return null
        if (trimmed.isEmpty() || trimmed == "*") return null
        return trimmed
    }
}
