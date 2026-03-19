import { describe, it, expect, beforeEach } from 'vitest'
import {
  getSTSPolicy,
  setSTSPolicy,
  parseSTSValue,
  loadSTSPolicies,
  getAllSTSPolicies
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
