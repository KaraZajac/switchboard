package org.switchboard.android.irc

/**
 * When to tell a channel that somebody is typing.
 *
 * The Kotlin half of `src/shared/typing.ts`, checked against
 * `tests/fixtures/typing.json`.
 *
 * This phone used to run the notice on a timer: `active` every three seconds
 * for as long as there was anything in the composer. Put a half-written
 * message down and walk away and it went on telling the channel you were
 * typing, indefinitely — and on send it said `done` twice, once from the send
 * and once from the box emptying behind it. Both were visible on the wire the
 * first time anyone watched it from outside.
 */
object Typing {

    /** The spec's one hard rule: at most one `active` every three seconds */
    const val THROTTLE_MS = 3_000L

    /** What just happened in the composer */
    enum class Event { TYPED, CLEARED, SENT }

    /**
     * @param send what to put on the wire, or null for nothing
     * @param lastActiveAt the state to hold until the next event, 0 for
     *   nothing outstanding
     */
    data class Decision(val send: String?, val lastActiveAt: Long)

    /**
     * Whether this event is worth a line, given what was last said.
     *
     * `done` only where an `active` is outstanding. Announcing that you have
     * stopped doing a thing you never said you were doing is noise, and on a
     * network that counts lines it is noise with a cost.
     */
    fun toSend(event: Event, lastActiveAt: Long, now: Long): Decision {
        if (event == Event.TYPED) {
            // 0 is "nothing outstanding" rather than a moment, so the throttle
            // has nothing to measure from and the first keystroke always
            // speaks.
            if (lastActiveAt == 0L) return Decision("active", now)
            if (now - lastActiveAt <= THROTTLE_MS) return Decision(null, lastActiveAt)
            return Decision("active", now)
        }

        if (lastActiveAt == 0L) return Decision(null, 0L)
        return Decision("done", 0L)
    }
}
