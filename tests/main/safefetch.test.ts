import { describe, it, expect, vi } from 'vitest'
import { isPrivateAddress } from '../../src/shared/privateaddress'

/**
 * Fetching a URL somebody else chose.
 *
 * Link previews are fetched by the desktop for links other people post, which
 * makes "make this request" something a stranger in a channel can ask of a
 * machine they cannot see. The destinations that matter are the ones that are
 * not on the internet.
 */
describe('addresses a preview must not reach', () => {
  const blocked = [
    ['loopback', '127.0.0.1'],
    ['anything else in 127/8', '127.13.99.4'],
    ['this network', '0.0.0.0'],
    ['a home router', '192.168.1.1'],
    ['RFC 1918, ten', '10.0.0.7'],
    ['RFC 1918, the awkward one', '172.20.3.4'],
    ['cloud metadata', '169.254.169.254'],
    ['carrier-grade NAT', '100.64.0.1'],
    ['multicast', '239.255.255.250'],
    ['broadcast', '255.255.255.255'],
    ['IPv6 loopback', '::1'],
    ['IPv6 unspecified', '::'],
    ['IPv6 unique local', 'fd00::1'],
    ['IPv6 link-local', 'fe80::1'],
    ['IPv4 in an IPv6 coat', '::ffff:127.0.0.1'],
    ['a bracketed literal', '[::1]'],
    ['nothing at all', ''],
    ['not an address', 'not-an-address'],
    ['an octet that is not one', '999.1.1.1']
  ]

  for (const [name, address] of blocked) {
    it(`refuses ${name}`, () => expect(isPrivateAddress(address)).toBe(true))
  }

  const allowed = [
    ['an ordinary host', '93.184.216.34'],
    ['the edge of 172.16/12', '172.32.0.1'],
    ['the other edge', '172.15.255.255'],
    ['a public one that looks close', '192.169.0.1'],
    ['one just under multicast', '223.255.255.255'],
    ['a public IPv6', '2606:4700:4700::1111']
  ]

  for (const [name, address] of allowed) {
    it(`allows ${name}`, () => expect(isPrivateAddress(address)).toBe(false))
  }
})

/**
 * And the name, not only the literal: a hostname resolves wherever its owner
 * points it, which is the whole trick.
 */
describe('what the resolver is asked', () => {
  it('refuses a name that resolves to somewhere private', async () => {
    vi.resetModules()
    vi.doMock('electron', () => ({ net: { fetch: vi.fn() } }))
    vi.doMock('dns/promises', () => ({
      lookup: async () => [{ address: '10.1.2.3' }]
    }))
    const { destinationAllowed } = await import('../../src/main/net/safefetch')
    expect(await destinationAllowed(new URL('http://inside.example/'))).toBe(false)
  })

  it('refuses a name with one public answer and one private', async () => {
    vi.resetModules()
    vi.doMock('electron', () => ({ net: { fetch: vi.fn() } }))
    vi.doMock('dns/promises', () => ({
      lookup: async () => [{ address: '93.184.216.34' }, { address: '127.0.0.1' }]
    }))
    const { destinationAllowed } = await import('../../src/main/net/safefetch')
    expect(await destinationAllowed(new URL('http://both.example/'))).toBe(false)
  })

  it('allows an ordinary public name', async () => {
    vi.resetModules()
    vi.doMock('electron', () => ({ net: { fetch: vi.fn() } }))
    vi.doMock('dns/promises', () => ({
      lookup: async () => [{ address: '93.184.216.34' }]
    }))
    const { destinationAllowed } = await import('../../src/main/net/safefetch')
    expect(await destinationAllowed(new URL('https://example.org/page'))).toBe(true)
  })

  it('refuses a scheme that is not the web, without asking DNS at all', async () => {
    vi.resetModules()
    const lookup = vi.fn()
    vi.doMock('electron', () => ({ net: { fetch: vi.fn() } }))
    vi.doMock('dns/promises', () => ({ lookup }))
    const { destinationAllowed } = await import('../../src/main/net/safefetch')
    expect(await destinationAllowed(new URL('file:///etc/passwd'))).toBe(false)
    expect(lookup).not.toHaveBeenCalled()
  })

  /**
   * A hostname is neither private nor public until something resolves it.
   * Refusing it for "not parsing as an address" would have refused every
   * preview there is — the two questions were briefly the same function.
   */
  it('refuses a literal private address without asking DNS either', async () => {
    vi.resetModules()
    const lookup = vi.fn()
    vi.doMock('electron', () => ({ net: { fetch: vi.fn() } }))
    vi.doMock('dns/promises', () => ({ lookup }))
    const { destinationAllowed } = await import('../../src/main/net/safefetch')
    expect(await destinationAllowed(new URL('http://127.0.0.1:8080/'))).toBe(false)
    expect(lookup).not.toHaveBeenCalled()
  })
})

describe('telling an address from a name', () => {
  it('knows which is which', async () => {
    const { isIpLiteral } = await import('../../src/shared/privateaddress')
    for (const literal of ['127.0.0.1', '8.8.8.8', '::1', 'fd00::1', '[::1]']) {
      expect(isIpLiteral(literal)).toBe(true)
    }
    for (const name of ['example.org', 'localhost', 'irc.libera.chat', '']) {
      expect(isIpLiteral(name)).toBe(false)
    }
  })

  /**
   * `localhost` is a name, so the literal check lets it past — and then the
   * resolver answers 127.0.0.1 and it is refused there. Worth pinning: it is
   * the first thing anybody would try.
   */
  it('still refuses localhost, by resolving it', async () => {
    vi.resetModules()
    vi.doMock('electron', () => ({ net: { fetch: vi.fn() } }))
    vi.doMock('dns/promises', () => ({ lookup: async () => [{ address: '127.0.0.1' }] }))
    const { destinationAllowed } = await import('../../src/main/net/safefetch')
    expect(await destinationAllowed(new URL('http://localhost:9222/json'))).toBe(false)
  })
})
