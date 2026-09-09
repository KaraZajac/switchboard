package org.switchboard.android.irc

import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * BATCH — messages that mean something different together than apart.
 *
 * Getting this wrong is not subtle. With event-playback a server replays old
 * JOINs, QUITs and NICKs inside the chathistory batch; handled as live traffic
 * they re-run the whole channel sync — NAMES, metadata, WHO and another
 * CHATHISTORY — whose reply replays the same events again. The client floods
 * itself in a loop it cannot see, and meanwhile removes people who never left.
 *
 * The desktop had exactly that bug. This is the same fix, in the same shape.
 */

/**
 * Batch types whose contents must not be treated as live traffic.
 *
 * These are the ones where the batch changes what the messages *mean*: history
 * is not news, a netsplit is one event rather than fifty quits, and the parts
 * of a multiline message are not separate messages. Every other type — `names`,
 * `metadata`, `labeled-response` — is a grouping hint, and the batch spec says
 * a client with nothing special to do with a type should process its messages
 * as if they had arrived unbatched.
 */
private val DEFERRED = setOf(
    "chathistory",
    "draft/chathistory",
    "netsplit",
    "netjoin",
    "draft/multiline",
    "multiline",
    // Search results are answers to a question, not new traffic: dispatching
    // them live would drop somebody's old messages into the live conversation.
    "search",
    "draft/search"
)

internal fun registerBatchHandlers() {

    Handlers.on("BATCH") { session, message ->
        val state = session.state
        val reference = message.param(0) ?: return@on
        val id = reference.drop(1)

        if (reference.startsWith("+")) {
            state.batches[id] = BatchState(
                id = id,
                type = message.param(1).orEmpty(),
                params = message.params.drop(2),
                parent = message.tag("batch")
            )
            return@on
        }

        if (!reference.startsWith("-")) return@on
        val batch = state.batches.remove(id) ?: return@on

        // A nested batch is completed by its parent, which is still open
        if (batch.parent != null && state.batches.containsKey(batch.parent)) return@on

        processBatch(session, batch)
    }
}

/**
 * Buffer a message that belongs to a batch we handle ourselves.
 *
 * Returns true when the message has been consumed and must not be dispatched.
 */
internal fun consumedByBatch(state: ConnectionState, message: IrcMessage): Boolean {
    val tag = message.tag("batch") ?: return false
    val batch = state.batches[tag] ?: return false

    // Only collect what we are going to do something with. A nested batch
    // inherits its ancestor's meaning: replayed history is still history.
    if (!isDeferred(state, batch)) return false

    batch.messages.add(message)
    return true
}

private fun isDeferred(state: ConnectionState, batch: BatchState): Boolean {
    val seen = mutableSetOf<String>()
    var current: BatchState? = batch

    while (current != null && seen.add(current.id)) {
        if (current.type in DEFERRED) return true
        current = current.parent?.let { state.batches[it] }
    }
    return false
}

private fun processBatch(session: IrcSession, batch: BatchState) {
    val state = session.state

    when (batch.type) {
        "chathistory", "draft/chathistory" -> {
            // History replays as messages, in order, with their own timestamps.
            // The joins and quits inside it are context, not events: acting on
            // them is what caused the loop this class exists to prevent.
            val target = batch.params.firstOrNull().orEmpty()
            for (message in batch.messages) {
                if (message.command != "PRIVMSG" && message.command != "NOTICE") continue
                val from = message.nick ?: continue
                val text = message.param(1) ?: continue

                session.emit("irc:message", buildJsonObject {
                    put("serverId", state.serverId)
                    put("channel", target.ifEmpty { message.param(0).orEmpty() })
                    put("message", buildJsonObject {
                        put("id", messageId(message, state.serverId))
                        put("nick", from)
                        put("content", text)
                        put("timestamp", timestampOf(message))
                        put("type", if (message.command == "NOTICE") "notice" else "privmsg")
                        put("historical", true)
                    })
                })
            }
        }

        "search", "draft/search" -> {
            // The same event the desktop sends when it searches on our behalf,
            // so the screen showing them does not know which client asked.
            session.emit("irc:search-results", buildJsonObject {
                put("serverId", state.serverId)
                put("messages", buildJsonArray {
                    for (message in batch.messages) {
                        if (message.command != "PRIVMSG" && message.command != "NOTICE") continue
                        val from = message.nick ?: continue
                        val text = message.param(1) ?: continue
                        add(buildJsonObject {
                            put("id", messageId(message, state.serverId))
                            put("channel", message.param(0))
                            put("nick", from)
                            put("content", text)
                            put("timestamp", timestampOf(message))
                        })
                    }
                })
            })
        }

        "draft/multiline", "multiline" -> {
            val lines = batch.messages.filter { it.command == "PRIVMSG" }
            val first = lines.firstOrNull() ?: return

            val text = Multiline.combine(lines)

            val target = batch.params.firstOrNull() ?: first.param(0).orEmpty()
            val from = first.nick ?: return
            val conversation = if (state.isMe(target)) from else target

            session.emit("irc:message", buildJsonObject {
                put("serverId", state.serverId)
                put("channel", conversation)
                put("message", buildJsonObject {
                    put("id", messageId(first, state.serverId))
                    put("nick", from)
                    put("content", text)
                    put("timestamp", timestampOf(first))
                    put("type", "privmsg")
                })
            })
        }

        "netsplit", "netjoin" -> {
            // Fifty quits at once is one event, and rendering it as fifty is
            // how a channel disappears behind a wall of noise.
            val nicks = batch.messages.mapNotNull { it.nick }
            for (nick in nicks) {
                if (batch.type == "netsplit") {
                    for (channel in state.channels.values) channel.removeUser(nick)
                }
            }
            session.emit("irc:netsplit", buildJsonObject {
                put("serverId", state.serverId)
                put("type", batch.type)
                put("count", nicks.size)
                put("servers", batch.params.joinToString(" "))
            })
        }
    }
}
