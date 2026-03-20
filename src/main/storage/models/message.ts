import { getDb, saveDatabase } from '../database'
import type { ChatMessage } from '@shared/types/message'
import { v4 as uuid } from 'uuid'

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

  return rows[0].values.map(rowToMessage).reverse()
}

export function searchMessages(
  serverId: string,
  query: string,
  options: { channel?: string; limit?: number } = {}
): ChatMessage[] {
  const db = getDb()
  const limit = options.limit || 50

  // Escape FTS5 special characters and add prefix matching
  const ftsQuery = query.replace(/['"]/g, '').trim()
  if (!ftsQuery) return []

  let sql: string
  let params: unknown[]

  if (options.channel) {
    sql = `SELECT m.* FROM messages m
           JOIN messages_fts fts ON m.rowid = fts.rowid
           WHERE fts.content MATCH ? AND m.server_id = ? AND m.channel = ?
           ORDER BY m.timestamp DESC LIMIT ?`
    params = [ftsQuery, serverId, options.channel, limit]
  } else {
    sql = `SELECT m.* FROM messages m
           JOIN messages_fts fts ON m.rowid = fts.rowid
           WHERE fts.content MATCH ? AND m.server_id = ?
           ORDER BY m.timestamp DESC LIMIT ?`
    params = [ftsQuery, serverId, limit]
  }

  try {
    const rows = db.exec(sql, params as number[])
    if (rows.length === 0) return []
    return rows[0].values.map(rowToMessage).reverse()
  } catch {
    return []
  }
}

export function deleteMessage(msgid: string): void {
  const db = getDb()
  db.run('DELETE FROM messages WHERE id = ?', [msgid])
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
    account: null,
    pending: false,
    reactions: {},
    channelContext: null
  }
}
