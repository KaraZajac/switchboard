import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { isPrivateAddress } from '../../src/shared/privateaddress'

/**
 * Fetching a URL somebody else chose.
 *
 * Link previews are fetched by the desktop for links other people post, which
 * makes "make this request" something a stranger in a channel can ask of a
 * machine they cannot see. The destinations that matter are the ones that are
 * not on the internet.
 */
const corpus = JSON.parse(
  readFileSync(join(__dirname, '../fixtures/privateaddress.json'), 'utf8')
) as {
  private: { name: string; address: string }[]
  public: { name: string; address: string }[]
  literals: { value: string; literal: boolean }[]
}

describe('addresses a preview must not reach', () => {
  for (const c of corpus.private) {
    it(`refuses ${c.name}`, () => expect(isPrivateAddress(c.address)).toBe(true))
  }
  for (const c of corpus.public) {
    it(`allows ${c.name}`, () => expect(isPrivateAddress(c.address)).toBe(false))
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
    for (const c of corpus.literals) {
      expect(isIpLiteral(c.value), c.value).toBe(c.literal)
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
