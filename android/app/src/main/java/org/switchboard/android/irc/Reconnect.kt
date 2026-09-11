package org.switchboard.android.irc

/**
 * How long to wait before dialling a server again.
 *
 * The Kotlin half of `src/shared/reconnect.ts`, checked against
 * `tests/fixtures/reconnect.json`.
 *
 * The ladder was never the problem. Both clients had a perfectly good
 * exponential backoff and neither ever climbed it, because both reset the
 * attempt counter the moment the socket opened rather than when the server
 * actually accepted them:
 *
 *     connectOnce()        // TCP is up
 *     attempt = 0          // <- here
 *     readLoop()           // ERROR :Closing Link ... (Throttled) - goodbye
 *
 * A server that accepts the connection and then closes it is a socket that
 * opens. So the counter went back to zero every time and the client retried at
 * the base delay for ever — a dial every two seconds, indefinitely, each one
 * refreshing the very window that was refusing it.
 *
 * The counter now resets on registration. Opening a socket is not being let
 * in; 001 is.
 */
object Reconnect {

    /** First retry. The two clients used to disagree: the desktop 1s, this 2s. */
    const val BASE_MS = 2_000L

    /** The ceiling. A client that gives up is one that silently stops being the connection. */
    const val MAX_MS = 300_000L

    /** The floor once a server has said we are coming back too fast */
    const val THROTTLED_FLOOR_MS = 60_000L

    private val SLOW_DOWN = listOf(
        "reconnecting too fast",
        "trying to reconnect too fast",
        "throttled",
        "too many connections",
        "try again later",
        "rate limit"
    )

    /** Whether the server is telling us to slow down */
    fun saysSlowDown(text: String?): Boolean {
        val said = text?.lowercase() ?: return false
        return SLOW_DOWN.any { said.contains(it) }
    }

    /**
     * @param attempt how many attempts have already failed — 1 for the first retry
     * @param lastError what the server said as it closed, if it said anything
     */
    fun delay(attempt: Int, lastError: String? = null): Long {
        val step = maxOf(1, attempt)
        // Shifting rather than pow, and capped before the shift can overflow
        val ladder = if (step - 1 >= 40) MAX_MS
        else minOf(MAX_MS, BASE_MS shl (step - 1))
        return if (saysSlowDown(lastError)) maxOf(ladder, THROTTLED_FLOOR_MS) else ladder
    }
}
