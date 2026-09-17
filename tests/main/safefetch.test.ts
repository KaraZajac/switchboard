import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { isPrivateAddress, publicAssetUrl } from '../../src/shared/privateaddress'

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

/**
 * A link that turns out not to be a page.
 *
 * This used to answer null for anything that was not HTML, which is right for
 * "there are no Open Graph tags here" and wrong as the whole answer: the
 * headers have just said what the thing is and how big it is, and that is
 * exactly what a file card needs. An APK linked in a channel rendered as a
 * bare blue address because the one request that could have described it threw
 * the description away.
 *
 * The body is still not read. Downloading forty megabytes to find out it is
 * forty megabytes would be absurd.
 */
describe('a link that is not a page', () => {
  const publicName = () => ({ lookup: async () => [{ address: '93.184.216.34' }] })

  async function fetching(headers: Record<string, string>, body = 'ignored') {
    vi.resetModules()
    vi.doMock('electron', () => ({ net: { fetch: vi.fn() } }))
    vi.doMock('dns/promises', () => publicName())

    const read = vi.fn(async () => {})
    const platform = await import('../../src/main/host')
    platform.setHost({
      ...platform.testHost('/tmp/switchboard-safefetch'),
      // The fetch the module actually calls — see `host().fetch`, which is
      // what makes the system proxy work in the app and a stand-in here
      fetch: (async () => ({
        ok: true,
        status: 200,
        headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
        body: {
          cancel: read,
          // `readCapped` reads a page a chunk at a time so a huge one cannot
          // be swallowed whole; one chunk is enough to stand in for that
          getReader: () => {
            let sent = false
            return {
              read: async () =>
                sent
                  ? { done: true, value: undefined }
                  : ((sent = true), { done: false, value: new TextEncoder().encode(body) }),
              cancel: async () => {},
              releaseLock: () => {}
            }
          }
        },
        text: async () => body,
        arrayBuffer: async () => new TextEncoder().encode(body).buffer
      })) as unknown as typeof globalThis.fetch
    })

    const { fetchForPreview } = await import('../../src/main/net/safefetch')
    return { page: await fetchForPreview('https://example.org/thing'), read }
  }

  it('says what it is and how big, rather than nothing', async () => {
    const { page } = await fetching({
      'content-type': 'application/vnd.android.package-archive',
      'content-length': '40748810'
    })

    expect(page).not.toBeNull()
    expect(page!.contentType).toBe('application/vnd.android.package-archive')
    expect(page!.contentLength).toBe(40748810)
    expect(page!.html, 'nothing was downloaded to say that').toBe('')
  })

  it('leaves the body alone', async () => {
    const { read } = await fetching({ 'content-type': 'application/pdf' })
    expect(read).toHaveBeenCalled()
  })

  it('leaves the size out where the server did not say', async () => {
    const { page } = await fetching({ 'content-type': 'application/pdf' })
    expect(page!.contentLength).toBe(null)
  })

  it('and out where it said something that is not a size', async () => {
    const { page } = await fetching({ 'content-type': 'application/pdf', 'content-length': 'lots' })
    expect(page!.contentLength).toBe(null)
  })

  it('still reads a page, and now says it was one', async () => {
    const { page } = await fetching(
      { 'content-type': 'text/html; charset=utf-8' },
      '<html><title>hi</title></html>'
    )

    expect(page!.contentType).toBe('text/html; charset=utf-8')
    expect(page!.html).toContain('<title>hi</title>')
  })
})

/**
 * And the two URLs the *page* chooses.
 *
 * A preview image and a favicon are picked by whatever is at the far end, so
 * each is another address a stranger's link gets to point at this machine —
 * and unlike the page itself, these are loaded by the window rather than
 * fetched here.
 *
 * The order of the two questions is the whole of it. Asking "is this private"
 * without first asking "is this an address" called every hostname on the
 * internet private, and every preview image and favicon was dropped on the way
 * to the window — for as long as the guard existed, on every site. It read as
 * pages that simply had no picture.
 */
describe('an image the page asked us to show', () => {
  it('lets an ordinary host through', () => {
    expect(publicAssetUrl('https://thumb.wikimedia.org/a/b.jpg')).toBe(
      'https://thumb.wikimedia.org/a/b.jpg'
    )
    expect(publicAssetUrl('https://torrentfreak.com/x.png')).toBe('https://torrentfreak.com/x.png')
  })

  it('and a public address written out as one', () => {
    expect(publicAssetUrl('https://1.1.1.1/x.png')).toBe('https://1.1.1.1/x.png')
  })

  it('refuses an address inside the house', () => {
    expect(publicAssetUrl('http://127.0.0.1:8080/x.png')).toBeUndefined()
    expect(publicAssetUrl('http://192.168.1.1/x.png')).toBeUndefined()
    expect(publicAssetUrl('http://10.0.0.5/x.png')).toBeUndefined()
    expect(publicAssetUrl('http://169.254.169.254/latest/meta-data')).toBeUndefined()
    expect(publicAssetUrl('http://[::1]/x.png')).toBeUndefined()
  })

  it('refuses a scheme a window has no business loading', () => {
    expect(publicAssetUrl('file:///etc/passwd')).toBeUndefined()
    expect(publicAssetUrl('data:image/png;base64,AAAA')).toBeUndefined()
    expect(publicAssetUrl('javascript:alert(1)')).toBeUndefined()
  })

  it('and anything that is not a URL at all', () => {
    expect(publicAssetUrl('')).toBeUndefined()
    expect(publicAssetUrl(undefined)).toBeUndefined()
    expect(publicAssetUrl('not a url')).toBeUndefined()
  })
})
