import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  expandAliases,
  fillParameters,
  performLines,
  validAliasName,
  type Alias
} from '@shared/aliases'

const corpus = JSON.parse(readFileSync(join(__dirname, '../fixtures/aliases.json'), 'utf8')) as {
  aliases: Alias[]
  cases: { name: string; input: string; lines?: string[]; error?: string }[]
  perform: { name: string; script: string; lines: string[] }[]
}

describe('commands you make up yourself', () => {
  for (const c of corpus.cases) {
    it(c.name, () => {
      const out = expandAliases(c.input, corpus.aliases)
      if (c.error) {
        expect(out.error).toBe(c.error)
        expect(out.lines).toEqual([])
      } else {
        expect(out.error).toBeUndefined()
        expect(out.lines).toEqual(c.lines)
      }
    })
  }

  /**
   * The one that matters for safety. An alias calling itself is a hang, and a
   * client that hangs on something the user typed is worse than one that
   * refuses it — so the depth limit is a rule, not a hope.
   */
  it('refuses a ring however long it is', () => {
    const ring: Alias[] = Array.from({ length: 20 }, (_, n) => ({
      name: `a${n}`,
      expansion: `/a${(n + 1) % 20}`
    }))
    const out = expandAliases('/a0', ring)
    expect(out.error).toBeTruthy()
    expect(out.lines).toEqual([])
  })

  it('lets one alias build on another', () => {
    const aliases: Alias[] = [
      { name: 'join2', expansion: '/j $1' },
      { name: 'j', expansion: '/join $1' }
    ]
    expect(expandAliases('/join2 #test', aliases).lines).toEqual(['/join #test'])
  })
})

describe('filling in parameters', () => {
  it('numbers them from one', () => {
    expect(fillParameters('$1 $2 $3', ['a', 'b', 'c'])).toBe('a b c')
  })

  it('leaves nothing behind for a parameter nobody gave', () => {
    // Not the literal `$3`, which would be sent to the server as text
    expect(fillParameters('$1 $3', ['a'])).toBe('a ')
  })

  it('takes everything, or everything from a point', () => {
    expect(fillParameters('$*', ['a', 'b', 'c'])).toBe('a b c')
    expect(fillParameters('$2-', ['a', 'b', 'c'])).toBe('b c')
    expect(fillParameters('$9-', ['a', 'b'])).toBe('')
  })

  it('keeps a doubled dollar as one', () => {
    expect(fillParameters('costs $$5', [])).toBe('costs $5')
  })

  it('leaves a dollar that means nothing alone', () => {
    expect(fillParameters('100% $ done', [])).toBe('100% $ done')
  })
})

describe('what to run on connect', () => {
  for (const c of corpus.perform) {
    it(c.name, () => expect(performLines(c.script)).toEqual(c.lines))
  }

  it('treats nothing at all as nothing to do', () => {
    expect(performLines(null)).toEqual([])
    expect(performLines(undefined)).toEqual([])
  })
})

describe('what may be an alias name', () => {
  it('accepts the shapes a command has', () => {
    for (const name of ['j', 'wii', 'my-alias', 'a_b', 'x1']) {
      expect(validAliasName(name)).toBe(true)
    }
  })

  it('refuses what would not survive being typed', () => {
    for (const name of ['', ' ', 'two words', '/j', 'a;b']) {
      expect(validAliasName(name)).toBe(false)
    }
  })
})
