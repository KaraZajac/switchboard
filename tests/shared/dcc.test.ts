import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  parseDcc,
  formatDcc,
  safeFilename,
  isReverse,
  addressFrom,
  integerFrom,
  type DccOffer
} from '@shared/dcc'

const corpus = JSON.parse(readFileSync(join(__dirname, '../fixtures/dcc.json'), 'utf8')) as {
  parse: { name: string; body: string; offer: DccOffer | null }[]
  format: { name: string; offer: DccOffer; line: string }[]
  names: { name: string; offered: string; safe: string }[]
}

describe('reading a DCC offer', () => {
  for (const c of corpus.parse) {
    it(c.name, () => {
      const offer = parseDcc(c.body)
      if (c.offer === null) {
        expect(offer).toBe(null)
        return
      }
      expect(offer?.kind).toBe(c.offer.kind)
      expect(offer?.filename).toBe(c.offer.filename)
      expect(offer?.address).toBe(c.offer.address)
      expect(offer?.port).toBe(c.offer.port)
      expect(offer?.size).toBe(c.offer.size)
      if (c.offer.token) expect(offer?.token).toBe(c.offer.token)
    })
  }

  it('knows a reverse offer from an ordinary one', () => {
    expect(isReverse(parseDcc('DCC SEND x 1 0 1 99')!)).toBe(true)
    expect(isReverse(parseDcc('DCC SEND x 1 5000 1')!)).toBe(false)
  })
})

describe('writing one', () => {
  for (const c of corpus.format) {
    it(c.name, () => expect(formatDcc(c.offer)).toBe(c.line))
  }

  /**
   * The property that matters. An offer we write and then read has to be the
   * offer we meant — the address in particular, since a wrong one is not a
   * failed transfer but a connection somewhere else.
   */
  it('round-trips through the parser', () => {
    const offers: DccOffer[] = [
      { kind: 'send', filename: 'a.txt', address: '10.0.0.1', port: 5000, size: 10 },
      { kind: 'send', filename: 'a b.txt', address: '255.255.255.255', port: 1, size: 0 },
      { kind: 'send', filename: 'x', address: '1.2.3.4', port: 0, size: 5, token: '7' },
      { kind: 'chat', filename: '', address: '8.8.8.8', port: 9000, size: 0 }
    ]
    for (const offer of offers) {
      const back = parseDcc(formatDcc(offer))
      expect(back?.address).toBe(offer.address)
      expect(back?.port).toBe(offer.port)
      expect(back?.filename).toBe(offer.filename)
    }
  })
})

describe('the address, which is an integer on the wire', () => {
  it('converts both ways', () => {
    const pairs: [string, string][] = [
      ['0.0.0.0', '0'],
      ['0.0.0.1', '1'],
      ['127.0.0.1', '2130706433'],
      ['192.168.1.1', '3232235777'],
      ['255.255.255.255', '4294967295']
    ]
    for (const [dotted, number] of pairs) {
      expect(integerFrom(dotted)).toBe(number)
      expect(addressFrom(number)).toBe(dotted)
    }
  })

  /**
   * The high bit is where a naive implementation goes wrong: `>>` on a number
   * above 2^31 is negative in JavaScript, so anything from 128.0.0.0 up comes
   * out as a different address entirely.
   */
  it('handles addresses above 128.0.0.0', () => {
    expect(addressFrom('2147483648')).toBe('128.0.0.0')
    expect(addressFrom('3232235777')).toBe('192.168.1.1')
    expect(integerFrom('192.168.1.1')).toBe('3232235777')
  })

  it('leaves alone what it cannot convert', () => {
    expect(addressFrom('::1')).toBe('::1')
    expect(addressFrom('192.168.1.1')).toBe('192.168.1.1')
    expect(addressFrom('99999999999999')).toBe('99999999999999')
    expect(integerFrom('::1')).toBe('::1')
    expect(integerFrom('1.2.3')).toBe('1.2.3')
    expect(integerFrom('1.2.3.999')).toBe('1.2.3.999')
  })
})

describe('what to call the file', () => {
  for (const c of corpus.names) {
    it(c.name, () => expect(safeFilename(c.offered)).toBe(c.safe))
  }

  /**
   * The name came from whoever sent it. Anything that could write outside the
   * folder the person chose has to be impossible, not merely unlikely.
   */
  it('cannot be made to write anywhere but where it was told', () => {
    const attempts = [
      '../../../etc/passwd',
      '..\\..\\..\\windows\\system32\\drivers\\etc\\hosts',
      '/absolute/path',
      'C:\\absolute\\path',
      '....//....//etc/passwd',
      'a/../../b'
    ]
    for (const attempt of attempts) {
      const safe = safeFilename(attempt)
      expect(safe).not.toContain('/')
      expect(safe).not.toContain('\\')
      expect(safe).not.toContain('..')
      expect(safe.startsWith('.')).toBe(false)
      expect(safe.length).toBeGreaterThan(0)
    }
  })
})
