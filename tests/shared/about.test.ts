import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { buildDate } from '@shared/about'

/**
 * The date on the About page.
 *
 * One rule rather than each runtime's own, because `toLocaleDateString` and
 * `DateTimeFormatter` do not agree and the two clients are meant to be one
 * client — see `@shared/about` and the Android `About`.
 */
const corpus = JSON.parse(readFileSync(join(__dirname, '../fixtures/about.json'), 'utf8')) as {
  dates: { name: string; iso: string; said: string }[]
}

describe('when this build was made', () => {
  for (const c of corpus.dates) {
    it(c.name, () => expect(buildDate(c.iso)).toBe(c.said))
  }

  it('says every month the way the other client does', () => {
    const months = Array.from({ length: 12 }, (_, i) =>
      buildDate(`2026-${String(i + 1).padStart(2, '0')}-01`)
    )
    expect(months).toEqual([
      '1 January 2026',
      '1 February 2026',
      '1 March 2026',
      '1 April 2026',
      '1 May 2026',
      '1 June 2026',
      '1 July 2026',
      '1 August 2026',
      '1 September 2026',
      '1 October 2026',
      '1 November 2026',
      '1 December 2026'
    ])
  })
})
