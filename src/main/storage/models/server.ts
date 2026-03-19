import { getDb, saveDatabase } from '../database'
import type { ServerConfig } from '@shared/types/server'
import type { SASLMechanism } from '@shared/types/irc'
import { v4 as uuid } from 'uuid'

/**
 * Server CRUD operations.
 */

export function getAllServers(): ServerConfig[] {
  const db = getDb()
  const rows = db.exec('SELECT * FROM servers ORDER BY sort_order ASC')
  if (rows.length === 0) return []

  return rows[0].values.map(rowToConfig)
}

export function getServer(id: string): ServerConfig | null {
  const db = getDb()
  const stmt = db.prepare('SELECT * FROM servers WHERE id = ?')
  stmt.bind([id])

  if (stmt.step()) {
    const row = stmt.getAsObject()
    stmt.free()
    return objectToConfig(row)
  }
  stmt.free()
  return null
}

export function addServer(config: Omit<ServerConfig, 'id' | 'sortOrder'>): string {
  const db = getDb()
  const id = uuid()

  // Get next sort order
  const maxResult = db.exec('SELECT COALESCE(MAX(sort_order), -1) + 1 FROM servers')
  const sortOrder = maxResult.length > 0 ? (maxResult[0].values[0][0] as number) : 0

  db.run(
    `INSERT INTO servers (id, name, host, port, tls, password, nick, username, realname,
     sasl_mechanism, sasl_username, sasl_password, auto_connect, auto_join, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      config.name,
      config.host,
      config.port,
      config.tls ? 1 : 0,
      config.password,
      config.nick,
      config.username,
      config.realname,
      config.saslMechanism,
      config.saslUsername,
      config.saslPassword,
      config.autoConnect ? 1 : 0,
      JSON.stringify(config.autoJoin),
      sortOrder
    ]
  )

  saveDatabase()
  return id
}

export function updateServer(id: string, updates: Partial<ServerConfig>): void {
  const db = getDb()
  const fields: string[] = []
  const values: unknown[] = []

  if (updates.name !== undefined) { fields.push('name = ?'); values.push(updates.name) }
  if (updates.host !== undefined) { fields.push('host = ?'); values.push(updates.host) }
  if (updates.port !== undefined) { fields.push('port = ?'); values.push(updates.port) }
  if (updates.tls !== undefined) { fields.push('tls = ?'); values.push(updates.tls ? 1 : 0) }
  if (updates.password !== undefined) { fields.push('password = ?'); values.push(updates.password) }
  if (updates.nick !== undefined) { fields.push('nick = ?'); values.push(updates.nick) }
  if (updates.username !== undefined) { fields.push('username = ?'); values.push(updates.username) }
  if (updates.realname !== undefined) { fields.push('realname = ?'); values.push(updates.realname) }
  if (updates.saslMechanism !== undefined) { fields.push('sasl_mechanism = ?'); values.push(updates.saslMechanism) }
  if (updates.saslUsername !== undefined) { fields.push('sasl_username = ?'); values.push(updates.saslUsername) }
  if (updates.saslPassword !== undefined) { fields.push('sasl_password = ?'); values.push(updates.saslPassword) }
  if (updates.autoConnect !== undefined) { fields.push('auto_connect = ?'); values.push(updates.autoConnect ? 1 : 0) }
  if (updates.autoJoin !== undefined) { fields.push('auto_join = ?'); values.push(JSON.stringify(updates.autoJoin)) }
  if (updates.sortOrder !== undefined) { fields.push('sort_order = ?'); values.push(updates.sortOrder) }

  if (fields.length === 0) return

  fields.push("updated_at = datetime('now')")
  values.push(id)

  db.run(`UPDATE servers SET ${fields.join(', ')} WHERE id = ?`, values)
  saveDatabase()
}

export function removeServer(id: string): void {
  const db = getDb()
  db.run('DELETE FROM servers WHERE id = ?', [id])
  saveDatabase()
}

// ── Row mapping helpers ────────────────────────────────────────────

function rowToConfig(row: unknown[]): ServerConfig {
  return {
    id: row[0] as string,
    name: row[1] as string,
    host: row[2] as string,
    port: row[3] as number,
    tls: (row[4] as number) === 1,
    password: row[5] as string | null,
    nick: row[6] as string,
    username: row[7] as string,
    realname: row[8] as string,
    saslMechanism: row[9] as SASLMechanism | null,
    saslUsername: row[10] as string | null,
    saslPassword: row[11] as string | null,
    autoConnect: (row[12] as number) === 1,
    autoJoin: JSON.parse((row[13] as string) || '[]'),
    sortOrder: row[14] as number
  }
}

function objectToConfig(row: Record<string, unknown>): ServerConfig {
  return {
    id: row['id'] as string,
    name: row['name'] as string,
    host: row['host'] as string,
    port: row['port'] as number,
    tls: (row['tls'] as number) === 1,
    password: row['password'] as string | null,
    nick: row['nick'] as string,
    username: row['username'] as string,
    realname: row['realname'] as string,
    saslMechanism: row['sasl_mechanism'] as SASLMechanism | null,
    saslUsername: row['sasl_username'] as string | null,
    saslPassword: row['sasl_password'] as string | null,
    autoConnect: (row['auto_connect'] as number) === 1,
    autoJoin: JSON.parse((row['auto_join'] as string) || '[]'),
    sortOrder: row['sort_order'] as number
  }
}
