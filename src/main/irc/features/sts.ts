/**
 * Strict Transport Security (STS) — IRCv3
 *
 * When connecting over plaintext:
 * - Server advertises sts capability: sts=port=6697,duration=2592000
 * - Client MUST disconnect and reconnect using TLS on the advertised port
 * - Client caches the policy for `duration` seconds
 *
 * When connecting over TLS:
 * - Client should cache the policy
 * - duration=0 means clear the cached policy
 *
 * The STS policy cache is managed by the storage layer.
 */

export interface STSPolicy {
  host: string
  port: number
  duration: number
  cachedAt: string // ISO 8601
}

/** In-memory STS policy cache (persisted to DB by the storage layer) */
const stsPolicies = new Map<string, STSPolicy>()

/**
 * Check if a host has an active STS policy.
 * Returns the policy if valid, null otherwise.
 */
export function getSTSPolicy(host: string): STSPolicy | null {
  const policy = stsPolicies.get(host.toLowerCase())
  if (!policy) return null

  // Check if expired
  const cachedAt = new Date(policy.cachedAt).getTime()
  const expiresAt = cachedAt + policy.duration * 1000
  if (Date.now() > expiresAt) {
    stsPolicies.delete(host.toLowerCase())
    return null
  }

  return policy
}

/**
 * Cache an STS policy (called when server advertises sts capability).
 */
export function setSTSPolicy(host: string, port: number, duration: number): void {
  if (duration === 0) {
    stsPolicies.delete(host.toLowerCase())
    return
  }

  stsPolicies.set(host.toLowerCase(), {
    host: host.toLowerCase(),
    port,
    duration,
    cachedAt: new Date().toISOString()
  })
}

/**
 * Load cached policies from storage (called at startup).
 */
export function loadSTSPolicies(policies: STSPolicy[]): void {
  for (const policy of policies) {
    stsPolicies.set(policy.host.toLowerCase(), policy)
  }
}

/**
 * Get all current policies (for persisting to storage).
 */
export function getAllSTSPolicies(): STSPolicy[] {
  return Array.from(stsPolicies.values())
}

/**
 * Parse the STS capability value.
 * Format: port=6697,duration=2592000
 */
export function parseSTSValue(value: string): { port: number; duration: number } | null {
  const parts: Record<string, string> = {}
  for (const segment of value.split(',')) {
    const eqIdx = segment.indexOf('=')
    if (eqIdx !== -1) {
      parts[segment.slice(0, eqIdx)] = segment.slice(eqIdx + 1)
    }
  }

  const port = parseInt(parts['port'] || '', 10)
  const duration = parseInt(parts['duration'] || '', 10)

  if (isNaN(port) || isNaN(duration)) return null

  return { port, duration }
}
