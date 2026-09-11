import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  socks5Greeting,
  readSocks5Choice,
  socks5AuthRequest,
  readSocks5AuthReply,
  socks5Connect,
  readSocks5Reply,
  socks4Connect,
  readSocks4Reply,
  proxyInUse,
  type ProxySettings
} from '@shared/socks'

const corpus = JSON.parse(readFileSync(join(__dirname, '../fixtures/socks.json'), 'utf8')) as {
  greeting: { name: string; hasCredentials: boolean; bytes: number[] }[]
  choice: { name: string; bytes: number[]; method: number | null }[]
  auth: { name: string; username: string; password: string; bytes: number[] }[]
  authReply: { name: string; bytes: number[]; ok: boolean | null }[]
  connect5: { name: string; host: string; port: number; bytes: number[] }[]
  reply5: { name: string; bytes: number[]; ok: boolean | null; error?: string; length?: number }[]
  connect4: { name: string; host: string; port: number; username: string; bytes: number[] }[]
  reply4: { name: string; bytes: number[]; ok: boolean | null; error?: string; length?: number }[]
  inUse: { name: string; proxy: ProxySettings; used: boolean }[]
}

const bytes = (values: number[]) => Uint8Array.from(values)
const list = (out: Uint8Array) => Array.from(out)

describe('the SOCKS5 greeting', () => {
  for (const c of corpus.greeting) {
    it(c.name, () => expect(list(socks5Greeting(c.hasCredentials))).toEqual(c.bytes))
  }
})

describe('what the proxy chose', () => {
  for (const c of corpus.choice) {
    it(c.name, () => expect(readSocks5Choice(bytes(c.bytes))).toBe(c.method))
  }
})

describe('sending a proxy password', () => {
  for (const c of corpus.auth) {
    it(c.name, () => expect(list(socks5AuthRequest(c.username, c.password))).toEqual(c.bytes))
  }

  it('refuses what the protocol cannot carry', () => {
    expect(() => socks5AuthRequest('x'.repeat(256), 'y')).toThrow()
    expect(() => socks5AuthRequest('x', 'y'.repeat(256))).toThrow()
  })

  for (const c of corpus.authReply) {
    it(c.name, () => expect(readSocks5AuthReply(bytes(c.bytes))).toBe(c.ok))
  }
})

describe('asking a SOCKS5 proxy to connect', () => {
  for (const c of corpus.connect5) {
    it(c.name, () => expect(list(socks5Connect(c.host, c.port))).toEqual(c.bytes))
  }

  /**
   * The reason the host goes as a name. A proxy exists to make the connection
   * from somewhere else; resolving here would announce the destination from
   * here, which is the thing being avoided.
   */
  it('never resolves the name itself', () => {
    const out = socks5Connect('irc.example.org', 6667)
    expect(out[3]).toBe(0x03)
    expect(new TextDecoder().decode(out.slice(5, 5 + out[4]))).toBe('irc.example.org')
  })

  it('refuses a host the protocol cannot carry', () => {
    expect(() => socks5Connect('', 6667)).toThrow()
    expect(() => socks5Connect('a'.repeat(256), 6667)).toThrow()
  })
})

describe('reading a SOCKS5 reply', () => {
  for (const c of corpus.reply5) {
    it(c.name, () => {
      const reply = readSocks5Reply(bytes(c.bytes))
      expect(reply.ok).toBe(c.ok)
      if (c.error) expect(reply.error).toBe(c.error)
      if (c.length !== undefined) expect(reply.length).toBe(c.length)
    })
  }

  /**
   * The length is not a detail: the proxy stops being a proxy the moment the
   * reply ends, and the next byte is the server's own greeting. Reading one
   * byte too many or too few loses or corrupts the first line of IRC.
   */
  it('says where the proxy stops and the server starts', () => {
    const reply = readSocks5Reply(
      Uint8Array.from([5, 0, 0, 1, 0, 0, 0, 0, 0, 0, ...new TextEncoder().encode(':server 001 ')])
    )
    expect(reply.ok).toBe(true)
    expect(reply.length).toBe(10)
  })

  it('does not decide on a prefix of a reply', () => {
    const full = Uint8Array.from([5, 0, 0, 1, 0, 0, 0, 0, 0, 0])
    for (let n = 0; n < full.length; n++) {
      expect(readSocks5Reply(full.slice(0, n)).ok).toBe(null)
    }
  })
})

describe('SOCKS4a', () => {
  for (const c of corpus.connect4) {
    it(c.name, () => expect(list(socks4Connect(c.host, c.port, c.username))).toEqual(c.bytes))
  }

  it('flags the hostname with an impossible address', () => {
    const out = socks4Connect('irc.example.org', 6667)
    expect(Array.from(out.slice(4, 8))).toEqual([0, 0, 0, 1])
  })

  for (const c of corpus.reply4) {
    it(c.name, () => {
      const reply = readSocks4Reply(bytes(c.bytes))
      expect(reply.ok).toBe(c.ok)
      if (c.error) expect(reply.error).toBe(c.error)
    })
  }
})

describe('whether a proxy is configured at all', () => {
  for (const c of corpus.inUse) {
    it(c.name, () => expect(proxyInUse(c.proxy)).toBe(c.used))
  }

  it('is false for nothing at all', () => {
    expect(proxyInUse(null)).toBe(false)
    expect(proxyInUse(undefined)).toBe(false)
  })
})
