import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  parseAttributes,
  networkFrom,
  isBouncer,
  bindBeforeRegistration,
  type BouncerNetwork
} from '@shared/bouncer'

const corpus = JSON.parse(readFileSync(join(__dirname, '../fixtures/bouncer.json'), 'utf8')) as {
  attributes: Array<{ name: string; text: string; pairs: Record<string, string | null> }>
  networks: Array<{
    name: string
    id: string
    text: string
    previous: BouncerNetwork | null
    network: BouncerNetwork
  }>
  recognised: Array<{
    name: string
    isupport: Record<string, string | true>
    caps: string[]
    bouncer: boolean
  }>
}

describe('reading what a bouncer says about a network', () => {
  for (const c of corpus.attributes) {
    it(c.name, () => {
      expect(Object.fromEntries(parseAttributes(c.text))).toEqual(c.pairs)
    })
  }
})

describe('the network that makes', () => {
  for (const c of corpus.networks) {
    it(c.name, () => {
      expect(networkFrom(c.id, parseAttributes(c.text), c.previous ?? undefined)).toEqual(c.network)
    })
  }
})

describe('recognising a bouncer', () => {
  for (const which of corpus.recognised) {
    it(which.name, () => {
      expect(isBouncer(which.isupport, which.caps)).toBe(which.bouncer)
    })
  }
})

describe("binding to one of a bouncer's networks", () => {
  const negotiated = ['sasl', 'batch', 'soju.im/bouncer-networks']

  it('binds when the far end speaks the extension', () => {
    // A registration-time command: the welcome that follows describes the
    // network it bound to, and a client reads that once
    expect(bindBeforeRegistration('1', negotiated)).toBe('BOUNCER BIND 1')
  })

  it('says nothing for an ordinary server', () => {
    expect(bindBeforeRegistration('1', ['sasl', 'batch'])).toBeNull()
  })

  it('says nothing when no network was named', () => {
    expect(bindBeforeRegistration(null, negotiated)).toBeNull()
    expect(bindBeforeRegistration(undefined, negotiated)).toBeNull()
    expect(bindBeforeRegistration('   ', negotiated)).toBeNull()
  })

  it('takes an id with a shape of its own', () => {
    // soju numbers them; Switchboard's bouncer uses the network's own id
    expect(bindBeforeRegistration('0789eb39-e883-4b0e', negotiated)).toBe(
      'BOUNCER BIND 0789eb39-e883-4b0e'
    )
  })
})
