import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { previewUrl, shareUrl, hasVideo, parseResults, type KlipyItem } from '../../src/shared/klipy'

/**
 * Which file to draw and which to send, out of the several Klipy offers.
 *
 * Shared with the phone's picker: a GIF picked on one device is a link the
 * other has to show, so both must choose the same one.
 */
const corpus = JSON.parse(readFileSync(join(__dirname, '../fixtures/klipy.json'), 'utf8')) as {
  picks: { name: string; item: KlipyItem; preview: string; share: string; video: boolean }[]
  results: { name: string; json: unknown; count: number }[]
}

describe('picking a file out of a Klipy item', () => {
  for (const c of corpus.picks) {
    it(c.name, () => {
      expect(previewUrl(c.item)).toBe(c.preview)
      expect(shareUrl(c.item)).toBe(c.share)
      expect(hasVideo(c.item)).toBe(c.video)
    })
  }
})

describe('finding the items in an answer', () => {
  for (const c of corpus.results) {
    it(c.name, () => expect(parseResults(c.json)).toHaveLength(c.count))
  }
})
