import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import { foldCase, casemappingOf } from '../../src/shared/casemap'

/**
 * Folding a name the way the server does.
 *
 * There was a `casemap()` on the connection state that implemented this and
 * was called from nowhere: every lookup used `toLowerCase()` instead, which is
 * wrong twice over — it does not fold `[]\~`, which rfc1459 servers do, and it
 * folds the whole of Unicode, which no server does.
 */

const corpus = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../fixtures/casemapping.json'), 'utf8')
)

const mappingOf = (value: string | null) => casemappingOf(value ?? undefined)

describe('folding a name', () => {
  for (const c of corpus.cases) {
    it(c.name, () => {
      expect(foldCase(c.input, mappingOf(c.value))).toBe(c.folded)
    })
  }
})

describe('whether two names are the same name', () => {
  for (const c of corpus.same) {
    it(c.name, () => {
      const mapping = mappingOf(c.value)
      expect(foldCase(c.a, mapping) === foldCase(c.b, mapping)).toBe(c.same)
    })
  }
})

describe('reading the mapping out of ISUPPORT', () => {
  it('takes the server at its word', () => {
    expect(casemappingOf('ascii')).toBe('ascii')
    expect(casemappingOf('rfc1459')).toBe('rfc1459')
    expect(casemappingOf('rfc1459-strict')).toBe('rfc1459-strict')
  })

  /** The RFC's default, and what rIRCd relies on by not advertising one */
  it('assumes rfc1459 when the server says nothing', () => {
    expect(casemappingOf(undefined)).toBe('rfc1459')
  })

  /** A bare CASEMAPPING token names no mapping, so it has not said anything */
  it('does not read a valueless token as a mapping', () => {
    expect(casemappingOf(true)).toBe('rfc1459')
  })
})

/**
 * And the part that actually broke: the maps.
 *
 * Folding correctly in a helper nobody calls is worth nothing. These go
 * through `ConnectionState`, which is what every handler reaches into.
 */
describe('finding a person the server considers the same person', () => {
  async function state(mapping?: string) {
    const { ConnectionState } = await import('../../src/main/irc/state')
    const s = new ConnectionState()
    if (mapping) s.isupport['CASEMAPPING'] = mapping
    return s
  }

  it('finds a channel written the other way round', async () => {
    const s = await state()
    s.getChannel('#dev[core]')

    expect(s.inChannel('#DEV{CORE}')).toBe(true)
    expect(s.getChannel('#dev{core}').name).toBe('#dev[core]')
  })

  it('finds a user written the other way round', async () => {
    const s = await state()
    const channel = s.getChannel('#lounge')
    channel.setUser('bob[away]', { nick: 'bob[away]' })

    expect(channel.hasUser('BOB{AWAY}')).toBe(true)
  })

  /** On an ascii server those really are two people, and must stay two */
  it('keeps them apart when the server says ascii', async () => {
    const s = await state('ascii')
    const channel = s.getChannel('#lounge')
    channel.setUser('bob[away]', { nick: 'bob[away]' })

    expect(channel.hasUser('bob{away}')).toBe(false)
    expect(channel.hasUser('BOB[AWAY]')).toBe(true)
  })

  it('renames across the two spellings', async () => {
    const s = await state()
    const channel = s.getChannel('#lounge')
    channel.setUser('n\\a', { nick: 'n\\a' })

    channel.renameUser('N|A', 'robin')

    expect(channel.hasUser('robin')).toBe(true)
    expect(channel.hasUser('n\\a')).toBe(false)
  })

  it('stops tracking a channel however it is spelled', async () => {
    const s = await state()
    s.getChannel('#a[b]')
    s.removeChannel('#A{B}')

    expect(s.inChannel('#a[b]')).toBe(false)
  })
})
