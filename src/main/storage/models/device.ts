import { getDb } from '../database'

/**
 * Devices paired to this desktop over the remote link.
 *
 * The endpoint id is an ed25519 public key, and iroh authenticates it as part
 * of the QUIC handshake — so a row here is what "this phone is allowed in"
 * means, and deleting one is a real revocation.
 */

export interface PairedDevice {
  endpointId: string
  name: string
  pairedAt: string
  lastSeenAt: string | null
}

export function getPairedDevices(): PairedDevice[] {
  const db = getDb()
  const rows = db.exec(
    'SELECT endpoint_id, name, paired_at, last_seen_at FROM remote_devices ORDER BY paired_at ASC'
  )
  if (rows.length === 0) return []

  return rows[0].values.map((row) => ({
    endpointId: row[0] as string,
    name: row[1] as string,
    pairedAt: row[2] as string,
    lastSeenAt: (row[3] as string) || null
  }))
}

export function isDevicePaired(endpointId: string): boolean {
  const db = getDb()
  const rows = db.exec('SELECT 1 FROM remote_devices WHERE endpoint_id = ?', [endpointId])
  return rows.length > 0 && rows[0].values.length > 0
}

export function pairDevice(endpointId: string, name: string): void {
  const db = getDb()
  db.run(
    `INSERT INTO remote_devices (endpoint_id, name, last_seen_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(endpoint_id) DO UPDATE SET name = excluded.name, last_seen_at = datetime('now')`,
    [endpointId, name]
  )
}

export function touchDevice(endpointId: string): void {
  const db = getDb()
  db.run("UPDATE remote_devices SET last_seen_at = datetime('now') WHERE endpoint_id = ?", [
    endpointId
  ])
}

export function revokeDevice(endpointId: string): void {
  const db = getDb()
  db.run('DELETE FROM remote_devices WHERE endpoint_id = ?', [endpointId])
}
