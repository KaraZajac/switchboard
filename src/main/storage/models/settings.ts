import { getDb, saveDatabase } from '../database'

/**
 * Key-value settings storage.
 */

export function getSetting<T = unknown>(key: string): T | null {
  const db = getDb()
  const stmt = db.prepare('SELECT value FROM settings WHERE key = ?')
  stmt.bind([key])

  if (stmt.step()) {
    const row = stmt.getAsObject()
    stmt.free()
    return JSON.parse(row['value'] as string) as T
  }
  stmt.free()
  return null
}

export function setSetting(key: string, value: unknown): void {
  const db = getDb()
  db.run(
    'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)',
    [key, JSON.stringify(value)]
  )
  saveDatabase()
}

export function deleteSetting(key: string): void {
  const db = getDb()
  db.run('DELETE FROM settings WHERE key = ?', [key])
  saveDatabase()
}
