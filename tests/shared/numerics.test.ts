import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { unclaimedNumeric } from '@shared/numerics'

const corpus = JSON.parse(readFileSync(join(__dirname, '../fixtures/numerics.json'), 'utf8')) as {
  unclaimed: { name: string; command: string; params: string[]; message: string }[]
  quiet: { name: string; command: string; params: string[] }[]
}

describe('a numeric nothing was listening for', () => {
  for (const c of corpus.unclaimed) {
    it(c.name, () => {
      expect(unclaimedNumeric(c.command, c.params)).toEqual({
        code: c.command,
        message: c.message
      })
    })
  }
})

describe('and one that is better left alone', () => {
  for (const c of corpus.quiet) {
    it(c.name, () => {
      expect(unclaimedNumeric(c.command, c.params)).toBe(null)
    })
  }
})

describe('how the sentence is put together', () => {
  it('drops our own nick, because the user knows who they are', () => {
    expect(unclaimedNumeric('482', ['kara', '#chan', "You're not a channel operator"])?.message)
      .toBe("#chan: You're not a channel operator")
  })

  it('keeps every piece of context in the order the server sent them', () => {
    expect(unclaimedNumeric('435', ['me', '#old', '#new', 'Cannot join, banned'])?.message)
      .toBe('#old #new: Cannot join, banned')
  })

  it('follows a nick with a space where the server wrote the sentence that way', () => {
    // The two families read differently: `No such channel` stands on its own,
    // `is in +g mode` was written to come after a name
    expect(unclaimedNumeric('716', ['me', 'bob', 'is in +g mode'])?.message)
      .toBe('bob is in +g mode')
    expect(unclaimedNumeric('403', ['me', 'bob', 'No such channel'])?.message)
      .toBe('bob: No such channel')
  })

  it('says only the sentence when there was no room for a nick', () => {
    // Before registration finishes the server has nothing to address it to
    expect(unclaimedNumeric('464', ['Password incorrect'])?.message).toBe('Password incorrect')
  })
})
