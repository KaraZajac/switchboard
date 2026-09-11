import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  actionsFor,
  parsePrefix,
  rankOf,
  quietMode,
  banMask,
  maskIsWeak,
  type MemberAction
} from '@shared/powers'

interface Case {
  name: string
  prefix: string
  chanmodes: string
  mine: string
  theirs: string
  isSelf: boolean
  ignored?: boolean
  actions: MemberAction[]
}

const corpus = JSON.parse(
  readFileSync(join(__dirname, '../fixtures/powers.json'), 'utf8')
) as {
  cases: Case[]
  masks: { name: string; nick: string; user: string | null; host: string | null; mask: string; weak: boolean }[]
}

describe('what you may do to somebody in a channel', () => {
  for (const c of corpus.cases) {
    it(c.name, () => {
      expect(
        actionsFor({
          prefix: c.prefix,
          chanmodes: c.chanmodes,
          mine: c.mine,
          theirs: c.theirs,
          isSelf: c.isSelf,
          ignored: c.ignored
        })
      ).toEqual(c.actions)
    })
  }

  it('reads a prefix scheme, and falls back when it cannot', () => {
    expect(parsePrefix('(qaohv)~&@%+')).toEqual({ modes: 'qaohv', symbols: '~&@%+' })
    expect(parsePrefix('')).toEqual({ modes: 'ov', symbols: '@+' })
    expect(parsePrefix('(ohv)@%')).toEqual({ modes: 'ov', symbols: '@+' })
  })

  it('ranks the highest badge somebody is wearing', () => {
    const scheme = parsePrefix('(qaohv)~&@%+')
    expect(rankOf('~@', scheme)).toBe(0)
    expect(rankOf('@+', scheme)).toBe(2)
    expect(rankOf('', scheme)).toBe(5)
  })

  /**
   * `q` is a prefix on one network and a quiet mode on another. Telling them
   * apart is the difference between muting somebody and handing them the
   * channel.
   */
  it('knows a quiet mode from a channel owner', () => {
    expect(quietMode('beIq,k,l,imnst', parsePrefix('(ohv)@%+'))).toBe('q')
    expect(quietMode('beI,k,l,imnst', parsePrefix('(qaohv)~&@%+'))).toBe(null)
    expect(quietMode('beIq,k,l,imnst', parsePrefix('(qaohv)~&@%+'))).toBe(null)
  })

  it('never offers to act on somebody who outranks you, whatever you hold', () => {
    const scheme = '(qaohv)~&@%+'
    for (const mine of ['', '+', '%', '@', '&']) {
      const offered = actionsFor({
        prefix: scheme, chanmodes: 'beI,k,l,imnst',
        mine, theirs: '~', isSelf: false
      })
      expect(offered).toEqual(['whois', 'message'])
    }
  })
})

describe('what to ban somebody with', () => {
  for (const m of corpus.masks) {
    it(m.name, () => {
      expect(banMask(m)).toBe(m.mask)
      expect(maskIsWeak(m)).toBe(m.weak)
    })
  }

  it('bans the host rather than the nick, because a nick takes one command to change', () => {
    const withHost = banMask({ nick: 'robin', host: 'example.org' })
    expect(withHost).not.toContain('robin')
    expect(withHost).toContain('example.org')
  })
})
