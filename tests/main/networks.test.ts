import { describe, it, expect } from 'vitest'
import { KNOWN_NETWORKS, NETWORKS_CHECKED_AT, suggestedNetworks } from '@shared/networks'

/**
 * The list offered to somebody with no networks.
 *
 * It is data rather than logic, so what is worth testing is that it stays
 * usable: a broken entry here is a first-run experience that dead-ends, and
 * this is the one screen where a user has no way to tell our mistake from
 * their own.
 *
 * The Android app reads the same file — `src/shared/networks.json`, copied into
 * its assets at build time — so there is nothing here for the two to disagree
 * about.
 */
describe('the networks we offer to start with', () => {
  it('has a useful number of them', () => {
    expect(KNOWN_NETWORKS.length).toBeGreaterThanOrEqual(8)
  })

  it('says when it was last checked', () => {
    expect(NETWORKS_CHECKED_AT).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('gives every one a name, a description and a place', () => {
    for (const network of KNOWN_NETWORKS) {
      expect(network.name, network.id).toBeTruthy()
      expect(network.description.length, network.id).toBeGreaterThan(20)
      expect(network.region, network.id).toBeTruthy()
    }
  })

  it('has no two the same', () => {
    const ids = KNOWN_NETWORKS.map((n) => n.id)
    expect(new Set(ids).size).toBe(ids.length)

    const hosts = KNOWN_NETWORKS.map((n) => n.host)
    expect(new Set(hosts).size).toBe(hosts.length)
  })

  it('points every one at a hostname and a port', () => {
    for (const network of KNOWN_NETWORKS) {
      expect(network.host, network.id).toMatch(/^[a-z0-9.-]+\.[a-z]{2,}$/)
      expect(network.port, network.id).toBeGreaterThan(0)
      expect(network.port, network.id).toBeLessThan(65536)
    }
  })

  /**
   * Nobody should be sent to a plain-text network by a list we wrote. Where a
   * network's own round-robin cannot be verified, the entry points at a server
   * that can — see IRCnet and EFnet.
   */
  it('sends nobody anywhere unencrypted', () => {
    for (const network of KNOWN_NETWORKS) {
      expect(network.tls, network.id).toBe(true)
    }
  })

  it('records what answered when each was checked', () => {
    for (const network of KNOWN_NETWORKS) {
      expect(network.checked, network.id).toBeTruthy()
    }
  })

  it('suggests channels that are channels', () => {
    for (const network of KNOWN_NETWORKS) {
      for (const channel of network.channels ?? []) {
        expect(channel, network.id).toMatch(/^#/)
      }
    }
  })

  // ── searching it ─────────────────────────────────────────────────

  it('offers everything when nothing has been typed', () => {
    expect(suggestedNetworks('')).toHaveLength(KNOWN_NETWORKS.length)
    expect(suggestedNetworks('   ')).toHaveLength(KNOWN_NETWORKS.length)
  })

  it('finds one by name', () => {
    expect(suggestedNetworks('libera').map((n) => n.id)).toEqual(['libera'])
  })

  it('finds them by what they are for', () => {
    expect(suggestedNetworks('anime').map((n) => n.id)).toContain('rizon')
    expect(suggestedNetworks('debian').map((n) => n.id)).toContain('oftc')
  })

  it('finds them by where they are', () => {
    const european = suggestedNetworks('europe').map((n) => n.id)
    expect(european).toContain('ircnet')
    expect(european).toContain('quakenet')
  })

  it('finds one by its address', () => {
    expect(suggestedNetworks('oftc.net').map((n) => n.id)).toEqual(['oftc'])
  })

  it('returns nothing for something that is not there', () => {
    expect(suggestedNetworks('zzzznotanetwork')).toEqual([])
  })
})
