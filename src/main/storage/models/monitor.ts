import { getDb, saveDatabase } from '../database'

export function getMonitorList(serverId: string): string[] {
  const db = getDb()
  const rows = db.exec('SELECT nick FROM monitor_list WHERE server_id = ?', [serverId])
  if (rows.length === 0) return []
  return rows[0].values.map((row) => row[0] as string)
}

export function addToMonitorList(serverId: string, nicks: string[]): void {
  const db = getDb()
  const stmt = db.prepare('INSERT OR IGNORE INTO monitor_list (server_id, nick) VALUES (?, ?)')
  for (const nick of nicks) {
    stmt.run([serverId, nick])
  }
  stmt.free()
  saveDatabase()
}

export function removeFromMonitorList(serverId: string, nicks: string[]): void {
  const db = getDb()
  for (const nick of nicks) {
    db.run('DELETE FROM monitor_list WHERE server_id = ? AND nick = ?', [serverId, nick])
  }
  saveDatabase()
}

export function clearMonitorList(serverId: string): void {
  const db = getDb()
  db.run('DELETE FROM monitor_list WHERE server_id = ?', [serverId])
  saveDatabase()
}
