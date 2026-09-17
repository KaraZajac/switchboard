import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { attachmentKind, attachmentName, humanSize, type AttachmentKind } from '@shared/attachment'

const corpus = JSON.parse(readFileSync(join(__dirname, '../fixtures/attachment.json'), 'utf8')) as {
  kinds: { name: string; url: string; contentType?: string; kind: AttachmentKind }[]
  names: { name: string; url: string; filename: string }[]
  sizes: { bytes: number | null; text: string | null }[]
}

describe('what a link points at', () => {
  for (const c of corpus.kinds) {
    it(c.name, () => {
      expect(attachmentKind(c.url, c.contentType)).toBe(c.kind)
    })
  }

  it('asks the server before it guesses', () => {
    // The host is authoritative about its own resource; the extension is a
    // guess somebody made before anybody looked
    expect(attachmentKind('https://example.org/thing.png', 'application/pdf')).toBe('file')
    expect(attachmentKind('https://example.org/thing.pdf', 'image/png')).toBe('image')
  })

  it('treats a URL it cannot even parse as a link', () => {
    expect(attachmentKind('not a url at all')).toBe('page')
  })
})

describe('what to call it', () => {
  for (const c of corpus.names) {
    it(c.name, () => {
      expect(attachmentName(c.url)).toBe(c.filename)
    })
  }
})

describe('how big it is', () => {
  for (const c of corpus.sizes) {
    it(`${c.bytes} → ${c.text}`, () => {
      expect(humanSize(c.bytes)).toBe(c.text)
    })
  }

  it('says nothing rather than something wrong', () => {
    expect(humanSize(undefined)).toBe(null)
    expect(humanSize(Number.NaN)).toBe(null)
    expect(humanSize(Number.POSITIVE_INFINITY)).toBe(null)
  })
})
