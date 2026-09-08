import { describe, it, expect, beforeEach } from 'vitest'
import {
  getSTSPolicy,
  setSTSPolicy,
  parseSTSValue,
  loadSTSPolicies,
  getAllSTSPolicies,
  stsUpgradeFor,
  persistSTSPoliciesWith,
  type STSPolicy
} from '../../src/main/irc/features/sts'

describe('STS (Strict Transport Security)', () => {
  beforeEach(() => {
    // Clear policies
    for (const policy of getAllSTSPolicies()) {
      setSTSPolicy(policy.host, policy.port, 0)
    }
  })

  describe('parseSTSValue', () => {
    it('parses valid STS value', () => {
      const result = parseSTSValue('port=6697,duration=2592000')
      expect(result).toEqual({ port: 6697, duration: 2592000 })
    })

    it('returns null for invalid STS value', () => {
      expect(parseSTSValue('invalid')).toBeNull()
      expect(parseSTSValue('port=abc,duration=123')).toBeNull()
      expect(parseSTSValue('')).toBeNull()
    })
  })

  describe('policy cache', () => {
    it('stores and retrieves policies', () => {
      setSTSPolicy('irc.example.com', 6697, 86400)
      const policy = getSTSPolicy('irc.example.com')

      expect(policy).not.toBeNull()
      expect(policy!.host).toBe('irc.example.com')
      expect(policy!.port).toBe(6697)
      expect(policy!.duration).toBe(86400)
    })

    it('is case-insensitive for host lookup', () => {
      setSTSPolicy('IRC.Example.COM', 6697, 86400)
      expect(getSTSPolicy('irc.example.com')).not.toBeNull()
    })

    it('clears policy when duration=0', () => {
      setSTSPolicy('irc.example.com', 6697, 86400)
      expect(getSTSPolicy('irc.example.com')).not.toBeNull()

      setSTSPolicy('irc.example.com', 6697, 0)
      expect(getSTSPolicy('irc.example.com')).toBeNull()
    })

    it('returns null for unknown hosts', () => {
      expect(getSTSPolicy('unknown.example.com')).toBeNull()
    })

    it('loads policies from storage', () => {
      loadSTSPolicies([
        { host: 'a.com', port: 6697, duration: 86400, cachedAt: new Date().toISOString() },
        { host: 'b.com', port: 6698, duration: 3600, cachedAt: new Date().toISOString() }
      ])

      expect(getSTSPolicy('a.com')).not.toBeNull()
      expect(getSTSPolicy('b.com')).not.toBeNull()
    })
  })
})

/**
 * Obeying the policy, which is the part that was missing.
 *
 * The cache existed and nothing ever read it: a server could say "TLS only" and
 * the next connection would still be dialled in the clear. These are about the
 * connection *after* the one that learned the policy, which is the only one the
 * feature protects.
 */
describe('acting on an STS policy', () => {
  beforeEach(() => {
    for (const policy of getAllSTSPolicies()) setSTSPolicy(policy.host, policy.port, 0)
    persistSTSPoliciesWith(null)
  })

  it('sends a later plaintext connection to the secure port', () => {
    setSTSPolicy('irc.example.org', 6697, 2592000)

    expect(stsUpgradeFor('irc.example.org', 6667, false)).toEqual({ port: 6697, tls: true })
  })

  it('leaves a connection that already satisfies the policy alone', () => {
    setSTSPolicy('irc.example.org', 6697, 2592000)

    expect(stsUpgradeFor('irc.example.org', 6697, true)).toBeNull()
  })

  it('moves a TLS connection on the wrong port to the right one', () => {
    setSTSPolicy('irc.example.org', 6697, 2592000)

    expect(stsUpgradeFor('irc.example.org', 7000, true)).toEqual({ port: 6697, tls: true })
  })

  it('has nothing to say about a host it was never told about', () => {
    expect(stsUpgradeFor('irc.other.org', 6667, false)).toBeNull()
  })

  it('matches the host whatever its case', () => {
    setSTSPolicy('IRC.Example.ORG', 6697, 2592000)

    expect(stsUpgradeFor('irc.example.org', 6667, false)).toEqual({ port: 6697, tls: true })
  })
})

/**
 * Keeping it between runs.
 *
 * A policy held only in memory is a plaintext window on every launch, which is
 * exactly what STS exists to close.
 */
describe('remembering an STS policy', () => {
  it('writes a policy through to storage, and drops it when withdrawn', () => {
    const written: STSPolicy[] = []
    const forgotten: string[] = []
    persistSTSPoliciesWith({
      save: (policy) => written.push(policy),
      forget: (host) => forgotten.push(host)
    })

    setSTSPolicy('irc.example.org', 6697, 2592000)
    expect(written).toHaveLength(1)
    expect(written[0]).toMatchObject({ host: 'irc.example.org', port: 6697 })

    setSTSPolicy('irc.example.org', 6697, 0)
    expect(forgotten).toContain('irc.example.org')

    persistSTSPoliciesWith(null)
  })

  it('applies a policy loaded from a previous run', () => {
    loadSTSPolicies([
      {
        host: 'irc.example.org',
        port: 6697,
        duration: 2592000,
        cachedAt: new Date().toISOString()
      }
    ])

    expect(stsUpgradeFor('irc.example.org', 6667, false)).toEqual({ port: 6697, tls: true })
  })

  it('forgets one that has expired rather than acting on it', () => {
    loadSTSPolicies([
      {
        host: 'stale.example.org',
        port: 6697,
        duration: 60,
        cachedAt: new Date(Date.now() - 120_000).toISOString()
      }
    ])

    expect(getSTSPolicy('stale.example.org')).toBeNull()
    expect(stsUpgradeFor('stale.example.org', 6667, false)).toBeNull()
  })
})

