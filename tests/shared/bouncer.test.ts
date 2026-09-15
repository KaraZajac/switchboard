import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { parseAttributes, networkFrom, type BouncerNetwork } from '@shared/bouncer'

const corpus = JSON.parse(readFileSync(join(__dirname, '../fixtures/bouncer.json'), 'utf8')) as {
  attributes: Array<{ name: string; text: string; pairs: Record<string, string | null> }>
  networks: Array<{
    name: string
    id: string
    text: string
    previous: BouncerNetwork | null
    network: BouncerNetwork
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
