import { getDb, saveDatabase } from '../database'
import { v4 as uuid } from 'uuid'

/**
 * Joined-channel tracking.
 *
 * Channels are remembered across restarts, so a channel joined by hand comes
 * back the next time the app connects — not just the ones listed in the
 * server's auto-join.
 */

/** Names of the channels we were in on this server, in join order. */
export function getJoinedChannels(serverId: string): string[] {
  const db = getDb()
  const rows = db.exec(
    'SELECT name FROM channels WHERE server_id = ? AND joined = 1 ORDER BY sort_order ASC',
    [serverId]
  )
  if (rows.length === 0) return []
  return rows[0].values.map((row) => row[0] as string)
}

/** Record that we joined a channel. */
export function markChannelJoined(serverId: string, name: string): void {
  const db = getDb()

  const existing = db.exec(
    'SELECT id FROM channels WHERE server_id = ? AND name = ? COLLATE NOCASE',
    [serverId, name]
  )

  if (existing.length > 0 && existing[0].values.length > 0) {
    db.run('UPDATE channels SET joined = 1 WHERE server_id = ? AND name = ? COLLATE NOCASE', [
      serverId,
      name
    ])
  } else {
    const maxResult = db.exec(
      'SELECT COALESCE(MAX(sort_order), -1) + 1 FROM channels WHERE server_id = ?',
      [serverId]
    )
    const sortOrder = maxResult.length > 0 ? (maxResult[0].values[0][0] as number) : 0
    db.run(
      'INSERT INTO channels (id, server_id, name, joined, sort_order) VALUES (?, ?, ?, 1, ?)',
      [uuid(), serverId, name, sortOrder]
    )
  }

  saveDatabase()
}

/** Record that we left a channel, so it is not rejoined on the next launch. */
export function markChannelParted(serverId: string, name: string): void {
  const db = getDb()
  db.run('UPDATE channels SET joined = 0 WHERE server_id = ? AND name = ? COLLATE NOCASE', [
    serverId,
    name
  ])
  saveDatabase()
}
