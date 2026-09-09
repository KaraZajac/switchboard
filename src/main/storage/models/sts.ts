import { getDb } from '../database'
import type { STSPolicy } from '../../irc/features/sts'

/**
 * STS policies, on disk.
 *
 * The whole point of Strict Transport Security is that it outlives the
 * session: a server says "always reach me over TLS, on this port, for the next
 * month", and a client that forgets on restart offers an attacker a plaintext
 * window on every launch. So it is kept here, not in memory.
 */

export function allSTSPolicies(): STSPolicy[] {
  const db = getDb()
  const rows = db.exec('SELECT host, port, duration, cached_at FROM sts_policies')
  if (rows.length === 0) return []

  return rows[0].values.map((row) => ({
    host: row[0] as string,
    port: row[1] as number,
    duration: row[2] as number,
    cachedAt: row[3] as string
  }))
}

export function saveSTSPolicy(policy: STSPolicy): void {
  const db = getDb()
  db.run(
    `INSERT OR REPLACE INTO sts_policies (host, port, duration, cached_at)
     VALUES (?, ?, ?, ?)`,
    [policy.host.toLowerCase(), policy.port, policy.duration, policy.cachedAt]
  )
}

export function forgetSTSPolicy(host: string): void {
  const db = getDb()
  db.run('DELETE FROM sts_policies WHERE host = ?', [host.toLowerCase()])
}
