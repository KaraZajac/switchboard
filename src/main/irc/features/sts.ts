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

/** In-memory cache, backed by the database so a policy survives a restart */
const stsPolicies = new Map<string, STSPolicy>()

/** Where policies are kept between runs; injected so this stays testable */
let store: {
  save: (policy: STSPolicy) => void
  forget: (host: string) => void
} | null = null

export function persistSTSPoliciesWith(backing: typeof store): void {
  store = backing
}

/**
 * Check if a host has an active STS policy.
 * Returns the policy if valid, null otherwise.
 */
export function getSTSPolicy(host: string): STSPolicy | null {
  // A hostname, not an IRC name: DNS folds ASCII case and nothing else, so
  // `toLowerCase` is right here and `casemap` would be wrong.
  const policy = stsPolicies.get(host.toLowerCase())
  if (!policy) return null

  // Check if expired
  const cachedAt = new Date(policy.cachedAt).getTime()
  const expiresAt = cachedAt + policy.duration * 1000
  if (Date.now() > expiresAt) {
    stsPolicies.delete(host.toLowerCase())
    store?.forget(host)
    return null
  }

  return policy
}

/**
 * Cache an STS policy (called when server advertises sts capability).
 */
export function setSTSPolicy(host: string, port: number, duration: number): void {
  if (duration === 0) {
    // duration=0 is the server withdrawing the policy
    stsPolicies.delete(host.toLowerCase())
    store?.forget(host)
    return
  }

  const policy: STSPolicy = {
    host: host.toLowerCase(),
    port,
    duration,
    cachedAt: new Date().toISOString()
  }
  stsPolicies.set(policy.host, policy)
  store?.save(policy)
}

/**
 * Where this server must actually be reached.
 *
 * Returns the port and TLS setting to dial with, which is the whole purpose of
 * the policy — a cached STS that nothing consults protects nobody.
 */
export function stsUpgradeFor(
  host: string,
  port: number,
  tls: boolean
): { port: number; tls: true } | null {
  const policy = getSTSPolicy(host)
  if (!policy) return null
  if (tls && port === policy.port) return null
  return { port: policy.port, tls: true }
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
