import { getDb, saveDatabase } from '../database'

/**
 * Reactions on messages.
 *
 * One row per person per emoji per message, which is what makes both halves
 * cheap: adding is an insert, taking one back is a delete, and nobody has to
 * read-modify-write a blob to do either.
 */

export function setReaction(
  serverId: string,
  channel: string,
  msgid: string,
  emoji: string,
  nick: string,
  removed: boolean
): void {
  const db = getDb()

  if (removed) {
    db.run(
      `DELETE FROM reactions
       WHERE server_id = ? AND channel = ? AND msgid = ? AND emoji = ? AND nick = ?`,
      [serverId, channel, msgid, emoji, nick]
    )
  } else {
    db.run(
      `INSERT OR IGNORE INTO reactions (server_id, channel, msgid, emoji, nick)
       VALUES (?, ?, ?, ?, ?)`,
      [serverId, channel, msgid, emoji, nick]
    )
  }

  saveDatabase()
}

/**
 * Reactions for a set of messages, as the UI wants them.
 *
 * Keyed by message id, then emoji, to the people who left it — asking per
 * message would be one query per line of history.
 */
export function reactionsFor(
  serverId: string,
  channel: string,
  msgids: string[]
): Record<string, Record<string, string[]>> {
  if (msgids.length === 0) return {}

  const db = getDb()
  const slots = msgids.map(() => '?').join(', ')
  const rows = db.exec(
    `SELECT msgid, emoji, nick FROM reactions
     WHERE server_id = ? AND channel = ? AND msgid IN (${slots})`,
    [serverId, channel, ...msgids] as unknown as number[]
  )
  if (rows.length === 0) return {}

  const byMessage: Record<string, Record<string, string[]>> = {}
  for (const [msgid, emoji, nick] of rows[0].values as [string, string, string][]) {
    const message = (byMessage[msgid] ??= {})
    ;(message[emoji] ??= []).push(nick)
  }
  return byMessage
}

/** Forget a message's reactions, when the message itself is taken back */
export function clearReactions(msgid: string): void {
  const db = getDb()
  db.run('DELETE FROM reactions WHERE msgid = ?', [msgid])
}
