import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  toMask,
  maskMatches,
  isIgnored,
  ignoresFor,
  withIgnore,
  withoutIgnore,
  DEFAULT_SCOPE,
  EVERYWHERE,
  type IgnoreEntry
} from '@shared/ignore'

const corpus = JSON.parse(readFileSync(join(__dirname, '../fixtures/ignore.json'), 'utf8')) as {
  mask: { name: string; typed: string; mask: string }[]
  match: {
    name: string
    mask: string
    who: { nick: string; user?: string; host?: string }
    matches: boolean
  }[]
  scope: {
    name: string
    list: IgnoreEntry[]
    network: string
    who: { nick: string; user?: string; host?: string }
    kind: 'messages' | 'requests'
    ignored: boolean
  }[]
  edit: { name: string; list: IgnoreEntry[]; add: IgnoreEntry; masks: string[] }[]
}

describe('what somebody typed', () => {
  for (const c of corpus.mask) {
    it(c.name, () => expect(toMask(c.typed)).toBe(c.mask))
  }

  /** Completing an already-complete mask would corrupt it */
  it('is idempotent', () => {
    for (const typed of ['kara', '*@host', 'a!b@c', 'kara!bot']) {
      expect(toMask(toMask(typed))).toBe(toMask(typed))
    }
  })
})

describe('whether a mask matches somebody', () => {
  for (const c of corpus.match) {
    it(c.name, () => expect(maskMatches(c.mask, c.who)).toBe(c.matches))
  }

  /**
   * The reason an ignore is a mask. Ignoring a nick and having them come back
   * under another one is the failure this whole feature is judged by, and a
   * host mask is the answer.
   */
  it('follows somebody through a nick change', () => {
    const who = { nick: 'kara', user: 'k', host: 'example.org' }
    const renamed = { ...who, nick: 'kara_' }
    expect(maskMatches('kara!*@*', renamed)).toBe(false)
    expect(maskMatches('*!*@example.org', renamed)).toBe(true)
  })

  /**
   * A pathological mask must not become a way to hang the client. `*a*a*a…b`
   * against a long name is the textbook case for a recursive matcher.
   */
  it('answers a pathological mask promptly', () => {
    const started = Date.now()
    expect(maskMatches('*a*a*a*a*a*a*a*a*a*a*b', { nick: 'a'.repeat(60), host: 'h' })).toBe(false)
    expect(Date.now() - started).toBeLessThan(100)
  })
})

describe('which network and what kind', () => {
  for (const c of corpus.scope) {
    it(c.name, () => expect(isIgnored(c.list, c.network, c.who, c.kind)).toBe(c.ignored))
  }

  it('reports every entry that covers somebody', () => {
    const list: IgnoreEntry[] = [
      { mask: 'kara!*@*', network: EVERYWHERE, scope: DEFAULT_SCOPE, added: 1 },
      { mask: '*!*@example.org', network: 'libera', scope: DEFAULT_SCOPE, added: 2 }
    ]
    expect(ignoresFor(list, 'libera', { nick: 'kara', host: 'example.org' })).toHaveLength(2)
    expect(ignoresFor(list, 'oftc', { nick: 'kara', host: 'example.org' })).toHaveLength(1)
  })
})

describe('editing the list', () => {
  for (const c of corpus.edit) {
    it(c.name, () => expect(withIgnore(c.list, c.add).map((e) => e.mask)).toEqual(c.masks))
  }

  it('removes by mask and network, not by who it happens to match', () => {
    const list: IgnoreEntry[] = [
      { mask: 'kara!*@*', network: EVERYWHERE, scope: DEFAULT_SCOPE, added: 1 },
      { mask: '*!*@example.org', network: EVERYWHERE, scope: DEFAULT_SCOPE, added: 2 }
    ]
    const after = withoutIgnore(list, 'kara!*@*', EVERYWHERE)
    expect(after.map((e) => e.mask)).toEqual(['*!*@example.org'])
  })

  it('leaves the list alone when nothing matches', () => {
    const list: IgnoreEntry[] = [
      { mask: 'kara!*@*', network: EVERYWHERE, scope: DEFAULT_SCOPE, added: 1 }
    ]
    expect(withoutIgnore(list, 'alice!*@*', EVERYWHERE)).toEqual(list)
  })
})
