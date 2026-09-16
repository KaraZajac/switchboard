import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { whoIsHolding, holdingLabel, type Holder, type HoldingNow } from '@shared/holding'

const corpus = JSON.parse(readFileSync(join(__dirname, '../fixtures/holding.json'), 'utf8')) as {
  cases: { name: string; now: HoldingNow; holder: Holder }[]
  labels: Record<string, string>
}

describe('which thing is holding the connections', () => {
  for (const c of corpus.cases) {
    it(c.name, () => {
      expect(whoIsHolding(c.now)).toBe(c.holder)
    })
  }

  it('spells each one the same on both clients', () => {
    // The half a person actually sees, so it is not left to each client
    for (const [holder, label] of Object.entries(corpus.labels)) {
      expect(holdingLabel(holder as Holder)).toBe(label)
    }
  })
})
