import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  parseAddress,
  addressesFor,
  addressForAttempt,
  formatAddress,
  type Address
} from '@shared/addresses'

const corpus = JSON.parse(readFileSync(join(__dirname, '../fixtures/addresses.json'), 'utf8')) as {
  parse: Array<{ name: string; text: string; fallback: Omit<Address, 'host'>; address: Address | null }>
  order: Array<{ name: string; config: never; addresses: Address[] }>
  attempts: Array<{ name: string; attempt: number; host: string }>
  attemptsConfig: never
}

describe('reading an address', () => {
  for (const c of corpus.parse) {
    it(c.name, () => expect(parseAddress(c.text, c.fallback)).toEqual(c.address))
  }
})

describe('the addresses a network will try', () => {
  for (const c of corpus.order) {
    it(c.name, () => expect(addressesFor(c.config)).toEqual(c.addresses))
  }
})

describe('falling through them', () => {
  for (const c of corpus.attempts) {
    it(c.name, () => {
      expect(addressForAttempt(corpus.attemptsConfig, c.attempt).host).toBe(c.host)
    })
  }

  it('a network with one address always uses it, however many attempts', () => {
    const only = { host: 'a.example.org', port: 6697, tls: true }
    for (const attempt of [0, 1, 7, 99]) {
      expect(addressForAttempt(only, attempt).host).toBe('a.example.org')
    }
  })

  it('a negative attempt is the first, not a crash', () => {
    expect(addressForAttempt(corpus.attemptsConfig, -1).host).toBe('a.example.org')
  })
})

describe('writing one back out', () => {
  it('leaves off what matches the network', () => {
    expect(
      formatAddress({ host: 'b.example.org', port: 6697, tls: true }, { port: 6697, tls: true })
    ).toBe('b.example.org')
  })

  it('marks TLS with a plus', () => {
    expect(formatAddress({ host: 'b.example.org', port: 6697, tls: true })).toBe('b.example.org:+6697')
  })

  it('brackets IPv6', () => {
    expect(formatAddress({ host: '2001:db8::1', port: 6667, tls: false })).toBe('[2001:db8::1]:6667')
  })

  it('round-trips through parsing', () => {
    const address = { host: 'b.example.org', port: 6667, tls: false }
    expect(parseAddress(formatAddress(address), { port: 6697, tls: true })).toEqual(address)
  })
})
