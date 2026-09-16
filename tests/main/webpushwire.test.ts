import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { registerPushEndpoint, unregisterPushEndpoint, pushKeys, vapidKeyFrom } from '../../src/main/irc/features/webpush'

/**
 * The WEBPUSH lines, as a server actually reads them.
 *
 * The crypto either side of this was written, checked against a shared corpus
 * and correct. The line that would have carried it was not: the keys go in
 * *one* parameter separated by a semicolon, and this sent them as two — so a
 * server read the public key as the whole of it, never saw the auth secret,
 * and answered `FAIL WEBPUSH INVALID_PARAMS :Keys must include p256dh and
 * auth`. Registration had never once succeeded, and nothing said so, because
 * nothing had yet been pointed at a server that implements the draft.
 */
const corpus = JSON.parse(readFileSync(join(__dirname, '../fixtures/webpush.json'), 'utf8')) as {
  register: { name: string; endpoint: string; p256dh?: string; auth?: string; line: string }[]
}

function client(...capabilities: string[]) {
  const sent: string[] = []
  return {
    sent,
    client: {
      state: { capabilities: new Set(capabilities) },
      connection: { send: (...args: string[]) => sent.push(args.join(' ')) }
    }
  }
}

describe('the WEBPUSH lines', () => {
  const [registering, unregistering] = corpus.register

  it(registering.name, () => {
    const { client: c, sent } = client('draft/webpush')

    expect(
      registerPushEndpoint(c, registering.endpoint, {
        p256dh: registering.p256dh!,
        auth: registering.auth!
      })
    ).toBe(true)

    expect(sent).toEqual([registering.line])
  })

  it('puts both keys in one parameter, which is the whole of this', () => {
    // Two parameters is what it sent before, and it is indistinguishable from
    // one on any client that never reads the reply
    const keys = pushKeys({ p256dh: 'AAA', auth: 'BBB' })
    expect(keys).toBe('p256dh=AAA;auth=BBB')
    expect(keys).not.toContain(' ')
  })

  it(unregistering.name, () => {
    const { client: c, sent } = client('draft/webpush')
    expect(unregisterPushEndpoint(c, unregistering.endpoint)).toBe(true)
    expect(sent).toEqual([unregistering.line])
  })

  it('says nothing at all on a network without the capability', () => {
    const { client: c, sent } = client('server-time')
    expect(registerPushEndpoint(c, 'https://push.example.org/f/x', { p256dh: 'A', auth: 'B' })).toBe(false)
    expect(sent).toEqual([])
  })
})

describe('the key a server offers to be pushed through', () => {
  it('is read from ISUPPORT, which is where rIRCd puts it', () => {
    // Read off irc.netslum.io: a 65-byte uncompressed P-256 point, base64url
    const key = 'BIIY03X3ETCHq38TEUxX32vqv-6BXT1bJNqtZP8a4M753l6GiPj6CM_YhTnGlp89fmXYLcyrS-_Yajs8uR-Ztsk'
    expect(vapidKeyFrom({ VAPID: key })).toBe(key)
  })

  it('or from the capability value, which is where the draft puts it', () => {
    expect(vapidKeyFrom({}, 'vapid=ABC,other=1')).toBe('ABC')
  })

  it('and is nothing at all when the server offers neither', () => {
    expect(vapidKeyFrom({}, undefined)).toBe(null)
    expect(vapidKeyFrom({ VAPID: '' })).toBe(null)
  })
})
