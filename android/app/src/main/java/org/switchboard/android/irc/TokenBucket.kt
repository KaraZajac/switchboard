package org.switchboard.android.irc

/**
 * How fast we are allowed to talk.
 *
 * Every ircd has a send-queue limit and enforces it by dropping commands or by
 * killing the connection with "Excess Flood". Taking over from the desktop is
 * exactly when the phone wants to say the most at once — subscribe, publish a
 * profile, join every channel, ask for history and names — so it is exactly
 * when the limit bites.
 *
 * A bucket rather than a fixed delay: a client that has been quiet can say
 * several things at once, which is what makes joining a few channels feel
 * instant, while a sustained stream settles to a rate servers accept.
 *
 * Separate from the connection, and taking its clock as an argument, so the
 * behaviour can be tested without waiting real seconds for it. The desktop's
 * equivalent has had `sendqueue.test.ts` since it was written.
 */
class TokenBucket(
    private val burst: Int,
    private val ratePerSecond: Double,
    private val clock: () -> Long = System::currentTimeMillis
) {
    private var tokens = burst.toDouble()
    private var lastRefill = clock()

    /**
     * Take a token, or say how long until one is free.
     *
     * 0 means it was taken and the caller may send now. Anything else is how
     * long to wait before asking again — the caller sleeps rather than this,
     * so nothing here has to be a coroutine.
     */
    fun take(): Long {
        val now = clock()
        tokens = minOf(burst.toDouble(), tokens + (now - lastRefill) / 1000.0 * ratePerSecond)
        lastRefill = now

        if (tokens >= 1.0) {
            tokens -= 1.0
            return 0L
        }

        // Never busy-wait: a floor keeps a caller that asks again immediately
        // from spinning on a bucket that is only microseconds short.
        return maxOf(10L, ((1.0 - tokens) / ratePerSecond * 1000).toLong())
    }

    /** How many are available right now, for tests and diagnostics */
    val available: Double get() = tokens
}
