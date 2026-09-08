import { getDb, saveDatabase } from '../database'
import type { ChatMessage } from '@shared/types/message'
import { v4 as uuid } from 'uuid'
import { reactionsFor, clearReactions } from './reaction'

/**
 * Message storage operations.
 */

export function storeMessage(msg: Omit<ChatMessage, 'pending' | 'reactions'>): void {
  const db = getDb()
  db.run(
    `INSERT OR IGNORE INTO messages (id, server_id, channel, nick, user_host, content, type, tags, reply_to, timestamp)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      msg.id || uuid(),
      msg.serverId,
      msg.channel,
      msg.nick,
      msg.userHost,
      msg.content,
      msg.type,
      JSON.stringify(msg.tags || {}),
      msg.replyTo,
      msg.timestamp
    ]
  )
  // Batch save — don't save on every single message
}

export function saveMessageBatch(): void {
  saveDatabase()
}

export function getMessages(
  serverId: string,
  channel: string,
  options: { before?: string; limit?: number } = {}
): ChatMessage[] {
  const db = getDb()
  const limit = options.limit || 50
  let query: string
  let params: unknown[]

  if (options.before) {
    query = `SELECT * FROM messages WHERE server_id = ? AND channel = ? AND timestamp < ?
             ORDER BY timestamp DESC LIMIT ?`
    params = [serverId, channel, options.before, limit]
  } else {
    query = `SELECT * FROM messages WHERE server_id = ? AND channel = ?
             ORDER BY timestamp DESC LIMIT ?`
    params = [serverId, channel, limit]
  }

  const rows = db.exec(query, params as number[])
  if (rows.length === 0) return []

  return withReactions(serverId, channel, rows[0].values.map(rowToMessage).reverse())
}

/** Hang the stored reactions back on the messages they belong to */
function withReactions(serverId: string, channel: string, messages: ChatMessage[]): ChatMessage[] {
  const found = reactionsFor(serverId, channel, messages.map((m) => m.id))
  if (Object.keys(found).length === 0) return messages
  return messages.map((message) =>
    found[message.id] ? { ...message, reactions: found[message.id] } : message
  )
}

export function searchMessages(
  serverId: string,
  query: string,
  options: { channel?: string; limit?: number } = {}
): ChatMessage[] {
  const db = getDb()
  const limit = options.limit || 50

  const term = query.replace(/['"]/g, '').trim()
  if (!term) return []

  let sql: string
  let params: unknown[]

  if (hasFtsIndex(db)) {
    if (options.channel) {
      sql = `SELECT m.* FROM messages m
             JOIN messages_fts fts ON m.rowid = fts.rowid
             WHERE fts.content MATCH ? AND m.server_id = ? AND m.channel = ?
             ORDER BY m.timestamp DESC LIMIT ?`
      params = [term, serverId, options.channel, limit]
    } else {
      sql = `SELECT m.* FROM messages m
             JOIN messages_fts fts ON m.rowid = fts.rowid
             WHERE fts.content MATCH ? AND m.server_id = ?
             ORDER BY m.timestamp DESC LIMIT ?`
      params = [term, serverId, limit]
    }
  } else {
    // sql.js ships without the FTS5 module, so messages_fts does not exist and
    // every search would come back empty. Substring matching instead.
    const like = `%${term.replace(/[\\%_]/g, '\\$&')}%`
    if (options.channel) {
      sql = `SELECT * FROM messages
             WHERE content LIKE ? ESCAPE '\\' AND server_id = ? AND channel = ?
             ORDER BY timestamp DESC LIMIT ?`
      params = [like, serverId, options.channel, limit]
    } else {
      sql = `SELECT * FROM messages
             WHERE content LIKE ? ESCAPE '\\' AND server_id = ?
             ORDER BY timestamp DESC LIMIT ?`
      params = [like, serverId, limit]
    }
  }

  try {
    const rows = db.exec(sql, params as number[])
    if (rows.length === 0) return []
    return rows[0].values.map(rowToMessage).reverse()
  } catch {
    return []
  }
}

/** Whether the FTS5 index exists — it does not when SQLite was built without FTS5. */
function hasFtsIndex(db: ReturnType<typeof getDb>): boolean {
  const rows = db.exec(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'messages_fts'"
  )
  return rows.length > 0 && rows[0].values.length > 0
}

/**
 * Apply an edit to a message already stored.
 *
 * Returns false when we never had the original, which is ordinary: the edit may
 * be for something said before this client was running.
 */
export function editStoredMessage(msgid: string, content: string, editedAt: string): boolean {
  const db = getDb()
  db.run('UPDATE messages SET content = ?, edited_at = ? WHERE id = ?', [content, editedAt, msgid])
  const changed = db.getRowsModified() > 0
  if (changed) saveDatabase()
  return changed
}

export function deleteMessage(msgid: string): void {
  const db = getDb()
  db.run('DELETE FROM messages WHERE id = ?', [msgid])
  // Its reactions go with it; nothing else will ever look them up
  clearReactions(msgid)
  saveDatabase()
}

function rowToMessage(row: unknown[]): ChatMessage {
  return {
    id: row[0] as string,
    serverId: row[1] as string,
    channel: row[2] as string,
    nick: row[3] as string,
    userHost: row[4] as string | null,
    content: row[5] as string,
    type: row[6] as ChatMessage['type'],
    tags: JSON.parse((row[7] as string) || '{}'),
    replyTo: row[8] as string | null,
    timestamp: row[9] as string,
    editedAt: (row[11] as string | null) || undefined,
    account: null,
    pending: false,
    reactions: {},
    channelContext: null
  }
}
