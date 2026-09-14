package org.switchboard.android

import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.switchboard.android.irc.HandoverQueue

/**
 * What this phone holds for the desktop while it is the connection.
 *
 * The phone has no database, so this queue is the only copy of an evening's
 * messages until the desktop takes them. Two things matter: it must not grow
 * without bound, and nothing may be dropped before the desktop has said it
 * has them — a link that dies mid-send is the ordinary case, not the odd one.
 */
class HandoverQueueTest {

    private fun message(id: String) = buildJsonObject {
        put("id", JsonPrimitive(id))
        put("nick", JsonPrimitive("robin"))
        put("content", JsonPrimitive("while you were out"))
    }

    @Test
    fun `hands over what it was given, with the conversation attached`() {
        val queue = HandoverQueue()
        queue.remember("srv", "#lobby", message("m1"))

        val batch = queue.peek()!!
        assertEquals("srv", batch.serverId)
        assertEquals(1, batch.count)
        assertEquals("#lobby", batch.rows[0].jsonObject["channel"]!!.jsonPrimitive.content)
        assertEquals("m1", batch.rows[0].jsonObject["id"]!!.jsonPrimitive.content)
    }

    @Test
    fun `a batch is one network, so the desktop is told which`() {
        val queue = HandoverQueue()
        queue.remember("one", "#a", message("m1"))
        queue.remember("one", "#b", message("m2"))
        queue.remember("two", "#c", message("m3"))

        val first = queue.peek()!!
        assertEquals("one", first.serverId)
        assertEquals(2, first.count)

        queue.drop(first.count)
        assertEquals("two", queue.peek()!!.serverId)
    }

    @Test
    fun `nothing waiting is nothing to send`() {
        assertNull(HandoverQueue().peek())
    }

    @Test
    fun `peeking does not drop, so a send that fails loses nothing`() {
        val queue = HandoverQueue()
        queue.remember("srv", "#lobby", message("m1"))

        queue.peek()
        queue.peek()

        assertEquals(1, queue.size)
        assertEquals("m1", queue.peek()!!.rows[0].jsonObject["id"]!!.jsonPrimitive.content)
    }

    @Test
    fun `what the desktop took is let go of`() {
        val queue = HandoverQueue()
        queue.remember("srv", "#lobby", message("m1"))
        queue.remember("srv", "#lobby", message("m2"))

        queue.drop(queue.peek()!!.count)

        assertEquals(0, queue.size)
        assertNull(queue.peek())
    }

    @Test
    fun `a long night drops the oldest rather than growing for ever`() {
        val queue = HandoverQueue(keep = 3)
        for (i in 1..5) queue.remember("srv", "#lobby", message("m$i"))

        assertEquals(3, queue.size)
        assertEquals(
            listOf("m3", "m4", "m5"),
            queue.peek()!!.rows.map { it.jsonObject["id"]!!.jsonPrimitive.content }
        )
    }

    @Test
    fun `a batch is capped, and the rest waits its turn`() {
        val queue = HandoverQueue(batch = 2)
        for (i in 1..5) queue.remember("srv", "#lobby", message("m$i"))

        val first = queue.peek()!!
        assertEquals(2, first.count)
        queue.drop(first.count)

        assertEquals(3, queue.size)
        assertEquals("m3", queue.peek()!!.rows[0].jsonObject["id"]!!.jsonPrimitive.content)
    }
}
