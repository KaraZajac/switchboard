import { getDb, saveDatabase } from '../database'

export function getReadMarker(serverId: string, channel: string): string | null {
  const db = getDb()
  const rows = db.exec(
    'SELECT timestamp FROM read_markers WHERE server_id = ? AND channel = ?',
    [serverId, channel]
  )
  if (rows.length === 0 || rows[0].values.length === 0) return null
  return rows[0].values[0][0] as string
}

export function setReadMarker(serverId: string, channel: string, timestamp: string): void {
  const db = getDb()
  db.run(
    `INSERT OR REPLACE INTO read_markers (server_id, channel, timestamp) VALUES (?, ?, ?)`,
    [serverId, channel, timestamp]
  )
  saveDatabase()
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
