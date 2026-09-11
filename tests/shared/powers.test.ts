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
  canModerate,
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

  /**
   * Rank decides what you may do *to a channel*. It has nothing to say about
   * what you do to your own client, so whois, message and ignore stay on
   * offer against the channel owner — you can always decide not to listen.
   */
  it('never offers to act on somebody who outranks you, whatever you hold', () => {
    const scheme = '(qaohv)~&@%+'
    const mine_own_business: MemberAction[] = ['whois', 'message', 'ignore', 'unignore']

    for (const mine of ['', '+', '%', '@', '&']) {
      const offered = actionsFor({
        prefix: scheme, chanmodes: 'beI,k,l,imnst',
        mine, theirs: '~', isSelf: false
      })
      expect(offered.filter((a) => !mine_own_business.includes(a))).toEqual([])
    }
  })

  /**
   * Ignoring is never about the network, so no rank and no ISUPPORT can take
   * it away — except against yourself, which would silence your own messages.
   */
  it('offers ignore to everybody, about everybody but you', () => {
    for (const mine of ['', '+', '%', '@', '~']) {
      for (const theirs of ['', '+', '@', '~']) {
        const offered = actionsFor({ prefix: '(qaohv)~&@%+', mine, theirs, isSelf: false })
        expect(offered).toContain('ignore')
      }
    }
    expect(actionsFor({ prefix: '(ohv)@%+', mine: '@', theirs: '@', isSelf: true }))
      .not.toContain('ignore')
  })

  it('offers to undo it where it is already done', () => {
    const offered = actionsFor({ prefix: '(ohv)@%+', mine: '', theirs: '', isSelf: false, ignored: true })
    expect(offered).toContain('unignore')
    expect(offered).not.toContain('ignore')
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

/**
 * Whether you could change a channel's settings and lists.
 *
 * Drawn by hand in two panels and backwards in both: `rankOf` returns 0 for
 * the most privileged, so `>= 2` meant "voiced or nothing". One of those
 * panels appeared to work only because its roster lookup was also failing.
 */
describe('who may change a channel', () => {
  const RIRCD = '(ohv)@%+'
  const UNREAL = '(qaohv)~&@%+'
  const SIMPLE = '(ov)@+'

  it('lets an operator through', () => {
    expect(canModerate(RIRCD, '@')).toBe(true)
    expect(canModerate(UNREAL, '@')).toBe(true)
    expect(canModerate(SIMPLE, '@')).toBe(true)
  })

  it('and anybody above one', () => {
    expect(canModerate(UNREAL, '~')).toBe(true)
    expect(canModerate(UNREAL, '&')).toBe(true)
  })

  it('lets a half-operator through where the network has them', () => {
    expect(canModerate(RIRCD, '%')).toBe(true)
    expect(canModerate(UNREAL, '%')).toBe(true)
  })

  /** The case that was inverted: voice is not moderation */
  it('does not let a voiced user through', () => {
    expect(canModerate(RIRCD, '+')).toBe(false)
    expect(canModerate(UNREAL, '+')).toBe(false)
    expect(canModerate(SIMPLE, '+')).toBe(false)
  })

  /** Nor somebody with nothing — which the backwards test let through */
  it('does not let somebody with no rank through', () => {
    expect(canModerate(RIRCD, '')).toBe(false)
    expect(canModerate(UNREAL, '')).toBe(false)
    expect(canModerate(SIMPLE, '')).toBe(false)
  })

  it('takes the highest of several prefixes', () => {
    expect(canModerate(RIRCD, '+@')).toBe(true)
    expect(canModerate(RIRCD, '@+')).toBe(true)
  })

  /**
   * A network that states no PREFIX still has operators — `parsePrefix` falls
   * back to the common scheme, which is what every client does. Somebody
   * wearing `@` is an operator whatever ISUPPORT left out.
   */
  it('falls back to the usual ranks when the network states none', () => {
    expect(canModerate('', '@')).toBe(true)
    expect(canModerate(null, '@')).toBe(true)
    expect(canModerate(null, '')).toBe(false)
    expect(canModerate(null, '+')).toBe(false)
  })

  /**
   * The same line `actionsFor` draws. If these two ever disagree, one of the
   * panels is offering a button the menu would have hidden.
   */
  it('agrees with what the member menu offers', () => {
    for (const prefix of [RIRCD, UNREAL, SIMPLE]) {
      for (const mine of ['', '+', '%', '@', '&', '~']) {
        const offered = actionsFor({
          prefix, chanmodes: 'beI,k,l,imnst', mine, theirs: '', isSelf: false
        })
        expect(canModerate(prefix, mine)).toBe(offered.includes('kick'))
      }
    }
  })
})
