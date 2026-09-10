import { getDb } from '../database'

export function getMonitorList(serverId: string): string[] {
  const db = getDb()
  // Ordered, so that sealing the same friend list twice produces the same
  // bytes. Without it an unstable row order is a config change to the vault,
  // and the two devices trade versions over nothing.
  const rows = db.exec(
    'SELECT nick FROM monitor_list WHERE server_id = ? ORDER BY nick',
    [serverId]
  )
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
}

export function removeFromMonitorList(serverId: string, nicks: string[]): void {
  const db = getDb()
  for (const nick of nicks) {
    db.run('DELETE FROM monitor_list WHERE server_id = ? AND nick = ?', [serverId, nick])
  }
}

export function clearMonitorList(serverId: string): void {
  const db = getDb()
  db.run('DELETE FROM monitor_list WHERE server_id = ?', [serverId])
}
