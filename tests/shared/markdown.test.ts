import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { COMMANDS } from '@shared/commandlist'
import { markdownForSend, markdownToIrc, spoilers } from '@shared/markdown'
import { FORMATTING_CODES } from '@shared/formatting'

/**
 * The markdown people already type — see `@shared/markdown` and the Android
 * `Markdown`, which this corpus also runs against.
 */
const corpus = JSON.parse(readFileSync(join(__dirname, '../fixtures/markdown.json'), 'utf8')) as {
  marks: { name: string; typed: string; sent: string }[]
  spoilers: { name: string; text: string; runs: [string, boolean][] }[]
  commands: { name: string; typed: string; sent: string }[]
}

describe('what goes on the wire', () => {
  for (const c of corpus.marks) {
    it(c.name, () => expect(markdownToIrc(c.typed)).toBe(c.sent))
  }

  it('never leaves a toggle unclosed', () => {
    // Every code this emits is a toggle, and an odd number of one of them
    // leaks the style into whatever is drawn next.
    const toggles = [
      FORMATTING_CODES.bold,
      FORMATTING_CODES.italic,
      FORMATTING_CODES.underline,
      FORMATTING_CODES.strikethrough
    ]
    for (const c of corpus.marks) {
      const sent = markdownToIrc(c.typed)
      for (const code of toggles) {
        const n = [...sent].filter((ch) => ch === code).length
        expect(n % 2, `${c.name}: ${n} of ${code.charCodeAt(0)}`).toBe(0)
      }
    }
  })

  it('leaves an already-converted message alone', () => {
    // What stops a second pass doubling every byte. Not idempotence in
    // general — an escape is spent the first time, as it is in every markdown
    // — but true of anything that came out of here carrying a code.
    const codes = Object.values(FORMATTING_CODES)
    for (const c of corpus.marks) {
      const once = markdownToIrc(c.typed)
      // Only where a code came out. An escape is spent on the first pass, as
      // it is in every markdown, so `\\*x\\*` becoming `*x*` becoming italics
      // is the rule working rather than failing — and it is unreachable
      // anyway, since nothing converts the same text twice.
      if (!codes.some((code) => once.includes(code))) continue
      expect(markdownToIrc(once), c.name).toBe(once)
    }
  })
})

describe('what is covered until somebody asks', () => {
  for (const c of corpus.spoilers) {
    it(c.name, () => {
      expect(spoilers(c.text).map((r) => [r.text, r.hidden])).toEqual(c.runs)
    })
  }

  it('always gives back exactly what it was given', () => {
    // The pieces have to reassemble, or an offset measured against them — a
    // link, a mention — lands somewhere else.
    for (const c of corpus.spoilers) {
      const rebuilt = spoilers(c.text)
        .map((r) => (r.hidden ? `||${r.text}||` : r.text))
        .join('')
      expect(rebuilt).toBe(c.text)
    }
  })
})

describe('a line that begins with a slash', () => {
  for (const c of corpus.commands) {
    it(c.name, () => {
      expect(markdownForSend(c.typed)).toBe(c.sent)
    })
  }

  it('touches nothing in a command the catalogue does not call prose', () => {
    // The guard that matters. Every other command has to come out byte for
    // byte, whatever punctuation is in it — a ban mask, a glob in /ignore, a
    // regex in /filter — because converting one would send a different
    // command than the one that was typed.
    for (const command of COMMANDS) {
      if (command.usage && /<(message|action)>$/.test(command.usage)) continue
      const typed = `/${command.name} #x +b *!*@host **loud** _quiet_`
      expect(markdownForSend(typed), command.name).toBe(typed)
    }
  })
})
