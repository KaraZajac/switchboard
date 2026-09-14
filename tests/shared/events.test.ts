import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { eventLine, isJoinOrPart, type ChannelEventKind } from '../../src/shared/events'

/**
 * What a join, part, kick or topic change says. One corpus with the phone,
 * so the two devices word the same event the same way.
 */
const corpus = JSON.parse(readFileSync(join(__dirname, '../fixtures/events.json'), 'utf8')) as {
  lines: { name: string; kind: ChannelEventKind; nick: string; detail?: string; reason?: string; line: string }[]
  hidden: Record<ChannelEventKind, boolean>
}

describe('wording a channel event', () => {
  for (const c of corpus.lines) {
    it(c.name, () =>
      expect(eventLine({ kind: c.kind, nick: c.nick, detail: c.detail, reason: c.reason })).toBe(c.line)
    )
  }
})

describe('what the joins-and-parts switch hides', () => {
  for (const [kind, hidden] of Object.entries(corpus.hidden)) {
    it(`${kind}: ${hidden ? 'hidden' : 'always shown'}`, () =>
      expect(isJoinOrPart(kind as ChannelEventKind)).toBe(hidden)
    )
  }
})
