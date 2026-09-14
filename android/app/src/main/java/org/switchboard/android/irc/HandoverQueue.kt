package org.switchboard.android.irc

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject

/**
 * What this phone heard while it was the connection, until the desktop takes it.
 *
 * The phone has no database. Its messages are what is on screen, and Android
 * may stop the process whenever it likes — so an evening spent holding the
 * connections used to end with those messages nowhere: gone from here on the
 * next restart, and never on the desktop at all unless the network happened to
 * offer `chathistory` for it to catch up from.
 *
 * Held in memory on purpose. That is the same lifetime as the messages
 * themselves, and a queue on disk outliving what it describes would promise
 * more than the rest of this client keeps.
 */
class HandoverQueue(
    /** Most to hold, oldest dropped first — a long night is not worth an OOM */
    private val keep: Int = 2_000,
    /** Most to send at once; the desktop refuses more than this anyway */
    private val batch: Int = 500
) {

    private data class Held(val serverId: String, val channel: String, val message: JsonObject)

    private val held = ArrayDeque<Held>()

    /** One batch, ready to send: everything in it is for the same network */
    data class Batch(val serverId: String, val rows: JsonArray, val count: Int)

    val size: Int get() = synchronized(held) { held.size }

    fun remember(serverId: String, channel: String, message: JsonObject) {
        synchronized(held) {
            held.addLast(Held(serverId, channel, message))
            while (held.size > keep) held.removeFirst()
        }
    }

    /**
     * The next batch, or null when there is nothing waiting.
     *
     * Taken from the front and *not* removed: a batch is only dropped once the
     * desktop has said it took it, so a link that dies mid-send loses nothing.
     */
    fun peek(): Batch? = synchronized(held) {
        val first = held.firstOrNull() ?: return null
        val rows = held
            .takeWhile { it.serverId == first.serverId }
            .take(batch)

        Batch(
            serverId = first.serverId,
            rows = JsonArray(
                rows.map { entry ->
                    buildJsonObject {
                        entry.message.forEach { (key, value) -> put(key, value) }
                        // The desktop files by conversation, and the message
                        // itself does not carry which one it belongs to
                        put("channel", JsonPrimitive(entry.channel))
                    }
                }
            ),
            count = rows.size
        )
    }

    /** The desktop has them; let them go */
    fun drop(count: Int) {
        synchronized(held) {
            repeat(count) { if (held.isNotEmpty()) held.removeFirst() }
        }
    }
}
