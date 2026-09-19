import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { joinsRun, type Runnable } from '@shared/grouping'

/**
 * When a message joins the run above it — see `@shared/grouping` and the
 * Android `Grouping`, which this corpus also runs against.
 */
const corpus = JSON.parse(readFileSync(join(__dirname, '../fixtures/grouping.json'), 'utf8')) as {
  cases: {
    name: string
    previous: Runnable | null
    message: Runnable
    sameDay: boolean
    joins: boolean
  }[]
}

describe('when a message joins the run above it', () => {
  for (const c of corpus.cases) {
    it(c.name, () => {
      expect(joinsRun(c.previous, c.message, c.sameDay)).toBe(c.joins)
    })
  }

  it('never joins a run it is the first of', () => {
    // The one that bit us: a reply drew no avatar and no name on the phone,
    // so the quoted line above it had nothing underneath saying who answered.
    for (const c of corpus.cases) {
      if (!c.message.replyTo) continue
      expect(joinsRun(c.previous, c.message, c.sameDay), c.name).toBe(false)
    }
  })
})
