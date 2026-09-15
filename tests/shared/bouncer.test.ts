import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { parseAttributes, networkFrom, isBouncer, type BouncerNetwork } from '@shared/bouncer'

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
