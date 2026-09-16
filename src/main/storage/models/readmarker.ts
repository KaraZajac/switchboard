import { getDb } from '../database'
import { movesForward } from '@shared/readmarker'

export function getReadMarker(serverId: string, channel: string): string | null {
  const db = getDb()
  const rows = db.exec(
    'SELECT timestamp FROM read_markers WHERE server_id = ? AND channel = ?',
    [serverId, channel]
  )
  if (rows.length === 0 || rows[0].values.length === 0) return null
  return rows[0].values[0][0] as string
}

/**
 * Note where a conversation was read up to.
 *
 * Forward only — see `@shared/readmarker`. This replaced whatever was there,
 * so a marker arriving late and stale dragged the line back up the
 * conversation and the messages already read were unread again.
 *
 * @returns the position afterwards, or null if it was not worth writing
 */
export function setReadMarker(
  serverId: string,
  channel: string,
  timestamp: string
): string | null {
  if (!movesForward(getReadMarker(serverId, channel), timestamp)) return null

  const db = getDb()
  db.run(
    `INSERT OR REPLACE INTO read_markers (server_id, channel, timestamp) VALUES (?, ?, ?)`,
    [serverId, channel, timestamp.trim()]
  )
  return timestamp.trim()
}

export function getAllReadMarkers(serverId: string): Record<string, string> {
  const db = getDb()
  const rows = db.exec(
    'SELECT channel, timestamp FROM read_markers WHERE server_id = ?',
    [serverId]
  )
  const markers: Record<string, string> = {}
  if (rows.length > 0) {
    for (const row of rows[0].values) {
      markers[row[0] as string] = row[1] as string
    }
  }
  return markers
}
