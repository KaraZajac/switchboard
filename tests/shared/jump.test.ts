import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { jumpPlan, type Jump, type Placed, type Target } from '@shared/jump'

const corpus = JSON.parse(readFileSync(join(__dirname, '../fixtures/jump.json'), 'utf8')) as {
  context: number
  plans: { name: string; loaded: Placed[]; target: Target; plan: Jump }[]
}

describe('whether a jump can be a scroll', () => {
  for (const c of corpus.plans) {
    it(c.name, () => {
      expect(jumpPlan(c.loaded, c.target, corpus.context)).toBe(c.plan)
    })
  }

  it('asks for as much room above as it is told to', () => {
    const loaded: Placed[] = corpus.plans[0].loaded
    const target: Target = { id: 'm2', timestamp: '2026-09-15T10:02:00.000Z' }

    // The same line is reachable or not depending on how much company it needs
    expect(jumpPlan(loaded, target, 2)).toBe('scroll')
    expect(jumpPlan(loaded, target, 3)).toBe('load')
  })

  it('prefers the id when both are given', () => {
    // A timestamp is a fallback, not a key: two lines share one often enough
    const loaded: Placed[] = [
      { id: 'a', timestamp: '2026-09-15T10:00:00.000Z' },
      { id: 'b', timestamp: '2026-09-15T10:00:00.000Z' }
    ]
    expect(jumpPlan(loaded, { id: 'zz', timestamp: '2026-09-15T10:00:00.000Z' }, 0)).toBe('load')
  })
})
