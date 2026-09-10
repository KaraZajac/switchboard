package org.switchboard.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.switchboard.android.irc.IrcConnection
import org.switchboard.android.irc.TokenBucket

/**
 * How fast the phone is allowed to talk.
 *
 * Every ircd has a send-queue limit and enforces it by dropping commands or by
 * killing the connection. Taking over from the desktop is exactly when the
 * phone wants to say the most at once, which is exactly when the limit bites —
 * and an unpaced client loses commands it will never notice losing. The
 * desktop's equivalent has had a test since it was written; this is the
 * phone's, against a clock it can move itself.
 */
class TokenBucketTest {

    private var now = 0L
    private fun bucket(burst: Int = 5, rate: Double = 1.0) =
        TokenBucket(burst, rate) { now }

    @Test
    fun `lets a short burst straight through`() {
        val bucket = bucket(burst = 5)
        repeat(5) { assertEquals("token ${it + 1} of the burst", 0L, bucket.take()) }
    }

    @Test
    fun `holds the next one back rather than dropping it`() {
        val bucket = bucket(burst = 5, rate = 1.0)
        repeat(5) { bucket.take() }

        val wait = bucket.take()
        assertTrue("the sixth waits", wait > 0)
        assertTrue("about a second at one per second", wait in 900..1100)
    }

    @Test
    fun `refills as time passes`() {
        val bucket = bucket(burst = 5, rate = 1.0)
        repeat(5) { bucket.take() }
        assertTrue(bucket.take() > 0)

        now += 1000
        assertEquals("a second later there is one to take", 0L, bucket.take())
    }

    @Test
    fun `does not save up more than the burst`() {
        val bucket = bucket(burst = 5, rate = 1.0)

        // Quiet for a minute: the point of a bucket is that it stops filling
        now += 60_000
        repeat(5) { assertEquals(0L, bucket.take()) }
        assertTrue("and no more than the burst", bucket.take() > 0)
    }

    @Test
    fun `never asks the caller to spin`() {
        val bucket = bucket(burst = 1, rate = 1000.0)
        bucket.take()

        // A bucket microseconds short would otherwise return 0ms and be asked
        // again immediately, for as long as that takes
        assertTrue("there is a floor on the wait", bucket.take() >= 10)
    }

    @Test
    fun `paces at the same numbers the desktop does`() {
        // Two clients that pace differently hit a server's limit differently,
        // and the one that takes over is the one that finds out
        assertEquals(5, IrcConnection.SEND_BURST)
        assertEquals(1.0, IrcConnection.SEND_RATE_PER_SECOND, 0.0)
    }
}
