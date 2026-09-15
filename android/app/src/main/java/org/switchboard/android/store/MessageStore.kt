package org.switchboard.android.store

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import org.switchboard.android.Message

/**
 * The phone's own record of what was said.
 *
 * Until this existed the phone kept messages only in memory, which meant two
 * things went wrong whenever Android stopped the process — routine on a phone,
 * and the whole reason this client runs a foreground service. Everything on
 * screen was gone on the next launch, so a conversation held on the train
 * could not be read at the station. And anything the phone had heard while it
 * was the connection went with it, before the desktop ever came back to be
 * told — the one copy of an evening's messages, lost to a low-memory kill.
 *
 * Small on purpose. A phone is not the archive; the desktop is, and keeps
 * everything. This holds the recent end of each conversation so the app opens
 * with something in it and so nothing is lost between hearing it and handing
 * it over. [KEEP_PER_CONVERSATION] is the ceiling and old rows are pruned as
 * new ones land.
 *
 * Plain SQLite in the app's private storage, not the keystore-sealed file the
 * vault uses. The vault holds passwords, which are worth the ceremony; this
 * holds what was said, which is already protected by the same two things every
 * other messaging app on the device relies on — the app sandbox and full-disk
 * encryption. Sealing it would also make it unsearchable, which is the point
 * of having it.
 */
class MessageStore(context: Context) {

    private val helper = object : SQLiteOpenHelper(context, NAME, null, VERSION) {
        override fun onCreate(db: SQLiteDatabase) {
            db.execSQL(
                """
                CREATE TABLE messages (
                    id TEXT PRIMARY KEY,
                    server_id TEXT NOT NULL,
                    conversation TEXT NOT NULL,
                    display_name TEXT NOT NULL,
                    nick TEXT NOT NULL,
                    content TEXT NOT NULL,
                    type TEXT NOT NULL,
                    timestamp TEXT NOT NULL,
                    reply_to TEXT,
                    oper TEXT,
                    relayed_by TEXT,
                    edited_at TEXT,
                    redacted_by TEXT,
                    needs_handover INTEGER NOT NULL DEFAULT 0
                )
                """.trimIndent()
            )
            // Reading a conversation is always "newest N of this one", and the
            // hand-over is always "what has not gone yet"
            db.execSQL("CREATE INDEX messages_conversation ON messages (server_id, conversation, timestamp)")
            db.execSQL("CREATE INDEX messages_pending ON messages (needs_handover)")
            createReadMarkers(db)
        }

        override fun onUpgrade(db: SQLiteDatabase, from: Int, to: Int) {
            // Migrate, never drop: this is somebody's history.
            if (from < 2) createReadMarkers(db)
        }

        /** Where each conversation was read up to — see [readMarker] */
        private fun createReadMarkers(db: SQLiteDatabase) {
            db.execSQL(
                """
                CREATE TABLE IF NOT EXISTS read_markers (
                    server_id TEXT NOT NULL,
                    conversation TEXT NOT NULL,
                    timestamp TEXT NOT NULL,
                    PRIMARY KEY (server_id, conversation)
                )
                """.trimIndent()
            )
        }
    }

    private val db: SQLiteDatabase get() = helper.writableDatabase

    /** A conversation, as this phone files it: channels fold case, people do not */
    private fun folded(channel: String) = channel.lowercase()

    /**
     * Write one down.
     *
     * [needsHandover] marks it as this phone's own hearing — something that
     * exists nowhere else until the desktop is told. Messages relayed from the
     * desktop are stored with it false: it wrote those as it sent them.
     */
    fun remember(serverId: String, channel: String, message: Message, needsHandover: Boolean) {
        if (message.id.isEmpty()) return

        val values = ContentValues().apply {
            put("id", message.id)
            put("server_id", serverId)
            put("conversation", folded(channel))
            put("display_name", channel)
            put("nick", message.nick)
            put("content", message.content)
            put("type", message.type)
            put("timestamp", message.timestamp)
            put("reply_to", message.replyTo)
            put("oper", message.oper)
            put("relayed_by", message.relayedBy)
            put("edited_at", message.editedAt)
            put("redacted_by", message.redactedBy)
            put("needs_handover", if (needsHandover) 1 else 0)
        }

        // CONFLICT_IGNORE, not REPLACE: the same message can arrive twice —
        // live and again in a replay — and the second one must not reset a
        // hand-over that has already happened, nor undo an edit.
        val written = db.insertWithOnConflict("messages", null, values, SQLiteDatabase.CONFLICT_IGNORE)
        if (written != -1L) prune(serverId, folded(channel))
    }

    /** A correction, kept as one */
    fun edit(id: String, content: String, editedAt: String) {
        db.update(
            "messages",
            ContentValues().apply {
                put("content", content)
                put("edited_at", editedAt)
            },
            "id = ?",
            arrayOf(id)
        )
    }

    /** A tombstone, because a message that silently vanishes reads as a bug */
    fun redact(id: String, by: String) {
        db.update("messages", ContentValues().apply { put("redacted_by", by) }, "id = ?", arrayOf(id))
    }

    /** The newest of one conversation, oldest first — the order they are read in */
    fun recent(serverId: String, channel: String, limit: Int = KEEP_PER_CONVERSATION): List<Message> {
        val rows = mutableListOf<Message>()
        db.rawQuery(
            """
            SELECT id, nick, content, type, timestamp, reply_to, oper, relayed_by, edited_at, redacted_by
            FROM messages WHERE server_id = ? AND conversation = ?
            ORDER BY timestamp DESC, rowid DESC LIMIT ?
            """.trimIndent(),
            arrayOf(serverId, folded(channel), limit.toString())
        ).use { cursor ->
            while (cursor.moveToNext()) rows.add(cursor.toMessage())
        }
        return rows.reversed()
    }

    /** Every conversation there is anything for, so a launch can put them back */
    fun conversations(): List<Conversation> {
        val found = mutableListOf<Conversation>()
        db.rawQuery(
            """
            SELECT server_id, conversation, MAX(display_name)
            FROM messages GROUP BY server_id, conversation
            """.trimIndent(),
            emptyArray()
        ).use { cursor ->
            while (cursor.moveToNext()) {
                found.add(Conversation(cursor.getString(0), cursor.getString(2) ?: cursor.getString(1)))
            }
        }
        return found
    }

    data class Conversation(val serverId: String, val channel: String)

    /** One network's worth of what has not been handed over, oldest first */
    fun pendingHandover(limit: Int = HANDOVER_BATCH): Pending? {
        var serverId: String? = null
        val rows = mutableListOf<Pair<String, Message>>()

        db.rawQuery(
            """
            SELECT server_id, display_name, id, nick, content, type, timestamp,
                   reply_to, oper, relayed_by, edited_at, redacted_by
            FROM messages WHERE needs_handover = 1
            ORDER BY rowid ASC LIMIT ?
            """.trimIndent(),
            arrayOf((limit * 4).toString())
        ).use { cursor ->
            while (cursor.moveToNext()) {
                val server = cursor.getString(0)
                if (serverId == null) serverId = server
                // One batch is one network, because that is what the desktop
                // is told to file it under
                if (server != serverId) break
                if (rows.size >= limit) break

                rows.add(
                    cursor.getString(1) to Message(
                        id = cursor.getString(2),
                        nick = cursor.getString(3),
                        content = cursor.getString(4),
                        type = cursor.getString(5),
                        timestamp = cursor.getString(6),
                        replyTo = cursor.getString(7),
                        oper = cursor.getString(8),
                        relayedBy = cursor.getString(9),
                        editedAt = cursor.getString(10),
                        redactedBy = cursor.getString(11)
                    )
                )
            }
        }

        val id = serverId ?: return null
        if (rows.isEmpty()) return null
        return Pending(id, rows)
    }

    data class Pending(val serverId: String, val rows: List<Pair<String, Message>>)

    /** The desktop has them now */
    fun markHandedOver(ids: List<String>) {
        if (ids.isEmpty()) return
        val marks = ids.joinToString(",") { "?" }
        db.execSQL(
            "UPDATE messages SET needs_handover = 0 WHERE id IN ($marks)",
            ids.toTypedArray()
        )
    }

    /** How much is still waiting, so a flush is only started when there is one */
    fun pendingCount(): Int =
        db.rawQuery("SELECT COUNT(*) FROM messages WHERE needs_handover = 1", emptyArray()).use {
            if (it.moveToFirst()) it.getInt(0) else 0
        }

    /**
     * The newest thing this phone holds for a network.
     *
     * Where a catch-up starts from when the desktop comes back. Null when
     * there is nothing, which means asking for everything the desktop will
     * give rather than nothing at all.
     */
    fun newestFor(serverId: String): String? =
        db.rawQuery(
            "SELECT MAX(timestamp) FROM messages WHERE server_id = ?",
            arrayOf(serverId)
        ).use { if (it.moveToFirst()) it.getString(0) else null }

    // ── read markers ────────────────────────────────────────────────

    /**
     * Where this conversation was read up to.
     *
     * The phone had nowhere to keep this, so `readMarkerFor` simply answered
     * null whenever the phone was the connection — and the "new messages" line
     * is drawn from that answer. The one mode this client exists for was the
     * one mode without it: come back to the phone after an hour and there was
     * nothing to say where you had got to.
     *
     * The desktop keeps the shared copy and its answer still wins while the
     * two are linked. This is what there is when they are not.
     */
    fun readMarker(serverId: String, channel: String): String? =
        db.rawQuery(
            "SELECT timestamp FROM read_markers WHERE server_id = ? AND conversation = ?",
            arrayOf(serverId, folded(channel))
        ).use { if (it.moveToFirst()) it.getString(0) else null }

    /**
     * Note where it was read up to.
     *
     * Forward only. Markers arrive from three directions — this phone reading,
     * the desktop's stored copy, and the server echoing `MARKREAD` — and one
     * of them turning up late must not drag the line back up the conversation.
     */
    fun rememberReadMarker(serverId: String, channel: String, timestamp: String) {
        if (timestamp.isBlank()) return
        val known = readMarker(serverId, channel)
        if (known != null && known >= timestamp) return

        db.insertWithOnConflict(
            "read_markers",
            null,
            ContentValues().apply {
                put("server_id", serverId)
                put("conversation", folded(channel))
                put("timestamp", timestamp)
            },
            SQLiteDatabase.CONFLICT_REPLACE
        )
    }

    /** A network this phone no longer has is a conversation it no longer keeps */
    fun forgetServer(serverId: String) {
        db.delete("messages", "server_id = ?", arrayOf(serverId))
        db.delete("read_markers", "server_id = ?", arrayOf(serverId))
    }

    /** Everything, for somebody who wants it gone */
    fun forgetEverything() {
        db.delete("messages", null, null)
        db.delete("read_markers", null, null)
    }

    /**
     * Keep the newest of a conversation and let the rest go.
     *
     * Never anything still waiting to be handed over, however old: dropping
     * one of those is dropping the only copy there is.
     */
    private fun prune(serverId: String, conversation: String) {
        db.execSQL(
            """
            DELETE FROM messages
            WHERE server_id = ? AND conversation = ? AND needs_handover = 0 AND id NOT IN (
                SELECT id FROM messages WHERE server_id = ? AND conversation = ?
                ORDER BY timestamp DESC, rowid DESC LIMIT ?
            )
            """.trimIndent(),
            arrayOf(serverId, conversation, serverId, conversation, KEEP_PER_CONVERSATION)
        )
    }

    private fun android.database.Cursor.toMessage() = Message(
        id = getString(0),
        nick = getString(1),
        content = getString(2),
        type = getString(3),
        timestamp = getString(4),
        replyTo = getString(5),
        oper = getString(6),
        relayedBy = getString(7),
        editedAt = getString(8),
        redactedBy = getString(9)
    )

    companion object {
        private const val NAME = "switchboard-messages.db"
        private const val VERSION = 2

        /**
         * The recent end of a conversation, not the whole of it.
         *
         * Enough to open the app and carry on reading; the desktop is where a
         * year of a channel lives. Two hundred is roughly a screenful times
         * ten, which is about as far back as anybody scrolls on a phone before
         * asking the network for more.
         */
        const val KEEP_PER_CONVERSATION = 200

        /** Most to hand over at once; the desktop refuses more than 500 anyway */
        const val HANDOVER_BATCH = 200
    }
}
