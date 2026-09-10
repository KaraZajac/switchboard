import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { decodeLine } from '../../src/shared/decoding'

const corpus = JSON.parse(
  readFileSync(join(__dirname, '../fixtures/decoding.json'), 'utf8')
) as { cases: { name: string; bytes: string; text: string }[] }

describe('shared line-decoding corpus', () => {
  for (const c of corpus.cases) {
    it(c.name, () => {
      expect(decodeLine(Buffer.from(c.bytes, 'hex'))).toBe(c.text)
    })
  }

  it('never returns a replacement character for bytes that meant something', () => {
    // Every byte 0x80–0xFF on its own is invalid UTF-8 and valid Windows-1252
    for (let byte = 0x80; byte <= 0xff; byte++) {
      const decoded = decodeLine(Uint8Array.from([byte]))
      expect(decoded).toHaveLength(1)
      expect(decoded).not.toBe('�')
    }
  })
})
