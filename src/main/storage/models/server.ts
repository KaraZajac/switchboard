import { getDb } from '../database'
import type { ServerConfig } from '@shared/types/server'
import type { SASLMechanism } from '@shared/types/irc'
import type { UserMetadata } from '@shared/types/metadata'
import { v4 as uuid } from 'uuid'
import {
  encryptSecret,
  readSecret,
  isPlaintextSecret,
  secretsProtected
} from '../secrets'

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
     sasl_mechanism, sasl_username, sasl_password, auto_connect, auto_join, sort_order, websocket_url, identify_command, avatar_url, pre_away_message, profile_metadata, client_cert)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      config.name,
      config.host,
      config.port,
      config.tls ? 1 : 0,
      encryptSecret(config.password),
      config.nick,
      config.username,
      config.realname,
      config.saslMechanism,
      config.saslUsername,
      encryptSecret(config.saslPassword),
      config.autoConnect ? 1 : 0,
      JSON.stringify(config.autoJoin),
      sortOrder,
      (config as Record<string, unknown>).websocketUrl || null,
      encryptSecret((config as Record<string, unknown>).identifyCommand as string | null),
      (config as Record<string, unknown>).avatarUrl || null,
      (config as Record<string, unknown>).preAwayMessage || null,
      JSON.stringify((config as Record<string, unknown>).profile ?? {}),
      encryptSecret((config as Record<string, unknown>).clientCert as string | null)
    ]
  )

  return id
}

export function updateServer(id: string, updates: Partial<ServerConfig>): void {
  const db = getDb()
  const fields: string[] = []
  const values: unknown[] = []

  if (updates.name !== undefined) {
    fields.push('name = ?')
    values.push(updates.name)
  }
  if (updates.host !== undefined) {
    fields.push('host = ?')
    values.push(updates.host)
  }
  if (updates.port !== undefined) {
    fields.push('port = ?')
    values.push(updates.port)
  }
  if (updates.tls !== undefined) {
    fields.push('tls = ?')
    values.push(updates.tls ? 1 : 0)
  }
  if (updates.password !== undefined) {
    fields.push('password = ?')
    values.push(encryptSecret(updates.password))
  }
  if (updates.nick !== undefined) {
    fields.push('nick = ?')
    values.push(updates.nick)
  }
  if (updates.username !== undefined) {
    fields.push('username = ?')
    values.push(updates.username)
  }
  if (updates.realname !== undefined) {
    fields.push('realname = ?')
    values.push(updates.realname)
  }
  if (updates.saslMechanism !== undefined) {
    fields.push('sasl_mechanism = ?')
    values.push(updates.saslMechanism)
  }
  if (updates.saslUsername !== undefined) {
    fields.push('sasl_username = ?')
    values.push(updates.saslUsername)
  }
  if (updates.saslPassword !== undefined) {
    fields.push('sasl_password = ?')
    values.push(encryptSecret(updates.saslPassword))
  }
  if (updates.clientCert !== undefined) {
    fields.push('client_cert = ?')
    values.push(encryptSecret(updates.clientCert))
  }
  if (updates.autoConnect !== undefined) {
    fields.push('auto_connect = ?')
    values.push(updates.autoConnect ? 1 : 0)
  }
  if (updates.autoJoin !== undefined) {
    fields.push('auto_join = ?')
    values.push(JSON.stringify(updates.autoJoin))
  }
  if (updates.sortOrder !== undefined) {
    fields.push('sort_order = ?')
    values.push(updates.sortOrder)
  }
  if (updates.websocketUrl !== undefined) {
    fields.push('websocket_url = ?')
    values.push(updates.websocketUrl)
  }
  if (updates.identifyCommand !== undefined) {
    fields.push('identify_command = ?')
    values.push(encryptSecret(updates.identifyCommand))
  }
  if (updates.performOnConnect !== undefined) {
    fields.push('perform_on_connect = ?')
    values.push(updates.performOnConnect)
  }
  if (updates.avatarUrl !== undefined) {
    fields.push('avatar_url = ?')
    values.push(updates.avatarUrl)
  }
  if (updates.preAwayMessage !== undefined) {
    fields.push('pre_away_message = ?')
    values.push(updates.preAwayMessage)
  }
  if (updates.profile !== undefined) {
    fields.push('profile_metadata = ?')
    values.push(JSON.stringify(updates.profile))
  }

  if (fields.length === 0) return

  fields.push("updated_at = datetime('now')")
  values.push(id)

  db.run(`UPDATE servers SET ${fields.join(', ')} WHERE id = ?`, values)
}

/**
 * Insert or update a server, keeping the id it already has.
 *
 * The vault syncs whole server records between devices, and matching on id is
 * what keeps an edit an edit rather than a duplicate.
 */
export function upsertServer(config: ServerConfig): void {
  const db = getDb()
  const existing = db.exec('SELECT 1 FROM servers WHERE id = ?', [config.id])

  if (existing.length > 0 && existing[0].values.length > 0) {
    updateServer(config.id, config)
    return
  }

  db.run(
    `INSERT INTO servers (id, name, host, port, tls, password, nick, username, realname,
     sasl_mechanism, sasl_username, sasl_password, auto_connect, auto_join, sort_order,
     websocket_url, identify_command, avatar_url, pre_away_message, profile_metadata, client_cert)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      config.id,
      config.name,
      config.host,
      config.port,
      config.tls ? 1 : 0,
      encryptSecret(config.password),
      config.nick,
      config.username,
      config.realname,
      config.saslMechanism,
      config.saslUsername,
      encryptSecret(config.saslPassword),
      config.autoConnect ? 1 : 0,
      JSON.stringify(config.autoJoin),
      config.sortOrder,
      config.websocketUrl,
      encryptSecret(config.identifyCommand),
      config.avatarUrl,
      config.preAwayMessage,
      JSON.stringify(config.profile ?? {})
    ]
  )
}

export function removeServer(id: string): void {
  const db = getDb()
  db.run('DELETE FROM servers WHERE id = ?', [id])
}

// ── Row mapping helpers ────────────────────────────────────────────

/** Profile metadata is stored as one JSON blob; a broken one must not stop a connect */
function parseProfile(raw: string | null): UserMetadata {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as UserMetadata) : {}
  } catch {
    return {}
  }
}

/**
 * Read the four credentials off a row, and note any that would not open.
 *
 * Together rather than one at a time, because the interesting answer is the
 * list: a connection needs to know *which* of them it cannot read before it
 * decides whether to dial.
 */
function secretsOf(raw: {
  password: unknown
  saslPassword: unknown
  identifyCommand: unknown
  clientCert: unknown
}): {
  password: string | null
  saslPassword: string | null
  identifyCommand: string | null
  clientCert: string | null
  unreadableSecrets?: string[]
} {
  const unreadable: string[] = []
  const read = (field: keyof typeof raw): string | null => {
    const { value, unreadable: failed } = readSecret(raw[field] as string | null)
    if (failed) unreadable.push(field)
    return value
  }

  return {
    password: read('password'),
    saslPassword: read('saslPassword'),
    identifyCommand: read('identifyCommand'),
    clientCert: read('clientCert'),
    ...(unreadable.length > 0 ? { unreadableSecrets: unreadable } : {})
  }
}

function rowToConfig(row: unknown[]): ServerConfig {
  return {
    id: row[0] as string,
    name: row[1] as string,
    host: row[2] as string,
    port: row[3] as number,
    tls: (row[4] as number) === 1,
    nick: row[6] as string,
    username: row[7] as string,
    realname: row[8] as string,
    saslMechanism: row[9] as SASLMechanism | null,
    saslUsername: row[10] as string | null,
    autoConnect: (row[12] as number) === 1,
    autoJoin: JSON.parse((row[13] as string) || '[]'),
    sortOrder: row[14] as number,
    websocketUrl: (row[17] as string) || null,
    avatarUrl: (row[19] as string) || null,
    preAwayMessage: (row[20] as string) || null,
    profile: parseProfile(row[21] as string | null),
    // Added last, by migration 014, so it is the last column SELECT * returns
    performOnConnect: (row[23] as string) || null,
    ...secretsOf({
      password: row[5],
      saslPassword: row[11],
      identifyCommand: row[18],
      clientCert: row[22]
    })
  }
}

function objectToConfig(row: Record<string, unknown>): ServerConfig {
  return {
    id: row['id'] as string,
    name: row['name'] as string,
    host: row['host'] as string,
    port: row['port'] as number,
    tls: (row['tls'] as number) === 1,
    nick: row['nick'] as string,
    username: row['username'] as string,
    realname: row['realname'] as string,
    saslMechanism: row['sasl_mechanism'] as SASLMechanism | null,
    saslUsername: row['sasl_username'] as string | null,
    autoConnect: (row['auto_connect'] as number) === 1,
    autoJoin: JSON.parse((row['auto_join'] as string) || '[]'),
    sortOrder: row['sort_order'] as number,
    websocketUrl: (row['websocket_url'] as string) || null,
    avatarUrl: (row['avatar_url'] as string) || null,
    preAwayMessage: (row['pre_away_message'] as string) || null,
    profile: parseProfile(row['profile_metadata'] as string | null),
    performOnConnect: (row['perform_on_connect'] as string) || null,
    ...secretsOf({
      password: row['password'],
      saslPassword: row['sasl_password'],
      identifyCommand: row['identify_command'],
      clientCert: row['client_cert']
    })
  }
}

/**
 * Encrypt any credentials still stored as plaintext.
 *
 * Runs once at startup after the database is open. Rows written by an older
 * build (or by a build that ran without a keyring) are rewritten in place;
 * anything already encrypted is left alone.
 */
export function encryptStoredCredentials(): { migrated: number; protected: boolean } {
  const db = getDb()
  const rows = db.exec('SELECT id, password, sasl_password, identify_command FROM servers')
  if (rows.length === 0) return { migrated: 0, protected: secretsProtected() }

  let migrated = 0

  for (const row of rows[0].values) {
    const [id, password, saslPassword, identifyCommand] = row as (string | null)[]
    if (
      !isPlaintextSecret(password) &&
      !isPlaintextSecret(saslPassword) &&
      !isPlaintextSecret(identifyCommand)
    ) {
      continue
    }

    db.run(
      'UPDATE servers SET password = ?, sasl_password = ?, identify_command = ? WHERE id = ?',
      [encryptSecret(password), encryptSecret(saslPassword), encryptSecret(identifyCommand), id]
    )
    migrated++
  }

  return { migrated, protected: secretsProtected() }
}
