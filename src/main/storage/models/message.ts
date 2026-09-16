import { getDb } from '../database'
import type { ChatMessage } from '@shared/types/message'
import { v4 as uuid } from 'uuid'
import { reactionsFor, clearReactions } from './reaction'
import { operFrom } from '@shared/tags'
import { mentionsYou } from '@shared/mentions'

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
  options: { before?: string; after?: string; limit?: number } = {}
): ChatMessage[] {
  const db = getDb()
  const limit = options.limit || 50
  let query: string
  let params: unknown[]

  if (options.after) {
    /*
     * Forwards from a point, in one conversation.
     *
     * What `CHATHISTORY AFTER` asks for. Ordered ascending in SQL rather than
     * descending and reversed, because the two disagree about *which* rows the
     * limit keeps: taking the newest 50 and turning them round answers "the
     * last 50" when the question was "the first 50 after this", and a client
     * paging forwards through a busy channel would skip everything between.
     */
    query = `SELECT * FROM messages WHERE server_id = ? AND channel = ? AND timestamp > ?
             ORDER BY timestamp ASC LIMIT ?`
    params = [serverId, channel, options.after, limit]
    const ascending = db.exec(query, params as number[])
    if (ascending.length === 0) return []
    return withReactions(serverId, channel, ascending[0].values.map(rowToMessage))
  }

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

/**
 * The conversations with anything in them, newest first.
 *
 * What `CHATHISTORY TARGETS` asks for: a client that has been away does not
 * know which conversations it missed, and a direct message from somebody new
 * leaves nothing else behind to notice.
 */
export function conversationsWithin(
  serverId: string,
  after: string,
  before: string,
  limit = 100
): { target: string; latest: string }[] {
  const db = getDb()
  const rows = db.exec(
    `SELECT channel, MAX(timestamp) AS latest FROM messages
     WHERE server_id = ? AND timestamp > ? AND timestamp < ?
     GROUP BY channel ORDER BY latest DESC LIMIT ?`,
    [serverId, after, before, limit] as unknown as number[]
  )
  if (rows.length === 0) return []
  return rows[0].values.map((row) => ({
    target: row[0] as string,
    latest: row[1] as string
  }))
}

/**
 * Everything said after a moment, across every conversation on a network.
 *
 * What a paired device asks for when it comes back. `getMessages` is the wrong
 * shape for it twice over: it reaches backwards from a point, and it wants to
 * be told which conversation — and a phone that has been off does not know
 * which conversations it missed, which is most of the problem.
 *
 * Ordered oldest first and capped, so a device that has been away for a month
 * walks forward through it a page at a time rather than asking for a year of
 * a busy channel in one call. The last row's timestamp is the next cursor.
 */
export function getMessagesSince(serverId: string, after: string, limit = 500): ChatMessage[] {
  const db = getDb()
  const rows = db.exec(
    `SELECT * FROM messages WHERE server_id = ? AND timestamp > ?
     ORDER BY timestamp ASC, rowid ASC LIMIT ?`,
    [serverId, after, limit] as unknown as number[]
  )
  if (rows.length === 0) return []

  const messages = rows[0].values.map(rowToMessage)

  // Reactions are looked up per conversation, and a page spans several
  const byChannel = new Map<string, ChatMessage[]>()
  for (const message of messages) {
    const list = byChannel.get(message.channel)
    if (list) list.push(message)
    else byChannel.set(message.channel, [message])
  }

  const hydrated = new Map<string, ChatMessage>()
  for (const [channel, list] of byChannel) {
    for (const message of withReactions(serverId, channel, list)) {
      hydrated.set(message.id, message)
    }
  }

  return messages.map((message) => hydrated.get(message.id) ?? message)
}

/** Hang the stored reactions back on the messages they belong to */
function withReactions(serverId: string, channel: string, messages: ChatMessage[]): ChatMessage[] {
  const found = reactionsFor(
    serverId,
    channel,
    messages.map((m) => m.id)
  )
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
  const rows = db.exec("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'messages_fts'")
  return rows.length > 0 && rows[0].values.length > 0
}

/**
 * Apply an edit to a message already stored.
 *
 * Returns false when we never had the original, which is ordinary: the edit may
 * be for something said before this client was running.
 */
/**
 * Everything on one network that named you, newest first.
 *
 * The badge on a channel counts these as they arrive and then forgets which
 * lines they were, so the one question it raises — *what did they say?* — had
 * no answer anywhere: you went network by network, channel by channel, looking
 * for your own nick in red.
 *
 * Two passes on purpose. SQL narrows it to lines containing the text somewhere,
 * which an index can do over a lot of history; `mentionsYou` then decides,
 * because that is the rule the badge and the notification already use and
 * "kara" appearing inside "karaoke" is not somebody talking to you. The first
 * pass takes more rows than asked for, since some of them will fall at the
 * second.
 *
 * Whose nick to look for is the caller's business: it is the one you have now,
 * not the one you had when the line arrived, which is the same approximation
 * the badge makes and the only one available without storing the answer.
 */
export function mentionsOn(
  serverId: string,
  nick: string,
  words: readonly string[],
  limit = 100
): ChatMessage[] {
  const db = getDb()

  const terms = [nick, ...words].map((term) => term.trim()).filter(Boolean)
  if (terms.length === 0) return []

  const clause = terms.map(() => "content LIKE ? ESCAPE '\\'").join(' OR ')
  const likes = terms.map((term) => `%${term.replace(/[\\%_]/g, '\\$&')}%`)

  // Notices too: a bot answering you is still somebody talking to you, and
  // plenty of networks do all their talking that way.
  const rows = db.exec(
    `SELECT * FROM messages
     WHERE server_id = ? AND type IN ('privmsg', 'action', 'notice') AND (${clause})
     ORDER BY timestamp DESC LIMIT ?`,
    [serverId, ...likes, limit * 4] as unknown as number[]
  )
  if (rows.length === 0) return []

  return rows[0].values
    .map(rowToMessage)
    .filter((message) => mentionsYou(message.content, nick, words))
    .slice(0, limit)
}

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
  const tags = JSON.parse((row[7] as string) || '{}')
  return {
    id: row[0] as string,
    serverId: row[1] as string,
    channel: row[2] as string,
    nick: row[3] as string,
    userHost: row[4] as string | null,
    content: row[5] as string,
    type: row[6] as ChatMessage['type'],
    tags,
    replyTo: row[8] as string | null,
    timestamp: row[9] as string,
    editedAt: (row[11] as string | null) || undefined,
    account: null,
    // Read back off the stored tags rather than a column of its own: the
    // whole tag record was kept, so the operator mark survives a restart
    // instead of quietly dropping off the message it was on.
    oper: operFrom(tags),
    pending: false,
    reactions: {},
    channelContext: null
  }
}
