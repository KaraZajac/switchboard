import { getDb } from '../database'
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

  const match = hasFtsIndex(db) ? ftsQuery(query) : null

  if (match) {
    if (options.channel) {
      sql = `SELECT m.* FROM messages m
             JOIN messages_fts fts ON m.rowid = fts.rowid
             WHERE messages_fts MATCH ? AND m.server_id = ? AND m.channel = ?
             ORDER BY m.timestamp DESC LIMIT ?`
      params = [match, serverId, options.channel, limit]
    } else {
      sql = `SELECT m.* FROM messages m
             JOIN messages_fts fts ON m.rowid = fts.rowid
             WHERE messages_fts MATCH ? AND m.server_id = ?
             ORDER BY m.timestamp DESC LIMIT ?`
      params = [match, serverId, limit]
    }
  } else {
    // No FTS5 in this build — the database was made by a sql.js Switchboard
    // and has not been reopened by one that could add the index. Substring
    // matching instead, which finds less but finds it correctly.
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

/**
 * What someone typed, as something FTS5 will accept.
 *
 * Typed text is not query syntax. A hyphen means NOT, a colon names a column,
 * an unattached `*` is a syntax error — and an error here would surface as
 * "no results", which is the one answer a search must never give wrongly.
 * Quoting each word makes it a literal, and the last word carries a `*` so the
 * list narrows while it is still being typed.
 *
 * Returns null when nothing usable is left, so the caller can fall back.
 */
function ftsQuery(text: string): string | null {
  const words = text
    .split(/\s+/)
    .map((word) => word.replace(/"/g, '').trim())
    .filter(Boolean)

  if (words.length === 0) return null
  return words.map((word, at) => `"${word}"${at === words.length - 1 ? '*' : ''}`).join(' ')
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
  return changed
}

export function deleteMessage(msgid: string): void {
  const db = getDb()
  db.run('DELETE FROM messages WHERE id = ?', [msgid])
  // Its reactions go with it; nothing else will ever look them up
  clearReactions(msgid)
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
