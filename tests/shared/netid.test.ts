import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { networkKey, sameNetwork, reidentified } from '@shared/netid'

const corpus = JSON.parse(
  readFileSync(join(__dirname, '../fixtures/netid.json'), 'utf8')
) as {
  same: Array<{ name: string; a: never; b: never; same: boolean }>
  reidentified: Array<{ name: string; mine: never[]; theirs: never[]; moves: Record<string, string> }>
}

describe('which network an entry is', () => {
  for (const c of corpus.same) {
    it(c.name, () => {
      expect(sameNetwork(c.a, c.b)).toBe(c.same)
      expect(networkKey(c.a) === networkKey(c.b)).toBe(c.same)
    })
  }

  it('is a string that can be used as a map key', () => {
    expect(networkKey({ host: 'irc.netslum.io', port: 6697, nick: 'sbtest' })).toBe(
      'irc.netslum.io:6697/sbtest'
    )
  })
})

describe('matching a config about to be adopted', () => {
  for (const c of corpus.reidentified) {
    it(c.name, () => {
      expect(reidentified(c.mine, c.theirs)).toEqual(c.moves)
    })
  }
})
