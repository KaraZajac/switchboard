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
  bind: Array<{ name: string; netId: string | null; negotiated: string[]; line: string | null }>
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
  // From the corpus, because the phone carried a network id through its
  // config and its connection and then never sent the line — the two halves
  // of this rule now have to agree in a place both of them read.
  for (const c of corpus.bind) {
    it(c.name, () => {
      expect(bindBeforeRegistration(c.netId, c.negotiated)).toBe(c.line)
    })
  }

  it('treats a missing id the same as a null one', () => {
    // Only TypeScript can say `undefined`; the corpus cannot
    expect(bindBeforeRegistration(undefined, ['soju.im/bouncer-networks'])).toBeNull()
  })
})
