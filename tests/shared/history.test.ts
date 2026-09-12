import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  emptyHistory,
  remember,
  older,
  newer,
  textOf,
  browsing,
  HISTORY_LIMIT,
  type History
} from '@shared/history'

type Step = { send?: string; up?: string; down?: true; type?: string }

const corpus = JSON.parse(readFileSync(join(__dirname, '../fixtures/history.json'), 'utf8')) as {
  cases: { name: string; steps: Step[]; text?: string; lines?: string[] }[]
}

/** Run a case's steps, tracking what is in the box as the UI would */
function play(steps: Step[]): { history: History; box: string } {
  let history = emptyHistory()
  let box = ''

  for (const step of steps) {
    if (step.send !== undefined) {
      history = remember(history, step.send)
      box = textOf(history)
    } else if (step.up !== undefined) {
      box = step.up
      history = older(history, box)
      box = textOf(history)
    } else if (step.down) {
      history = newer(history)
      box = textOf(history)
    } else if (step.type !== undefined) {
      box = step.type
    }
  }

  return { history, box }
}

describe('getting back a line you already sent', () => {
  for (const c of corpus.cases) {
    it(c.name, () => {
      const { history, box } = play(c.steps)
      if (c.text !== undefined) expect(box).toBe(c.text)
      if (c.lines !== undefined) expect(history.lines).toEqual(c.lines)
    })
  }

  it('keeps a bounded number of lines', () => {
    let history = emptyHistory()
    for (let i = 0; i < HISTORY_LIMIT * 3; i++) history = remember(history, `line ${i}`)

    expect(history.lines).toHaveLength(HISTORY_LIMIT)
    // The newest survive; the oldest are what is dropped
    expect(history.lines[0]).toBe(`line ${HISTORY_LIMIT * 3 - 1}`)
  })

  /**
   * The key has to fall through when there is nothing to recall, or Up stops
   * moving the caret in a half-written paragraph — which is what the key does
   * the rest of the time.
   */
  it('says when it is not browsing, so the key can do its usual job', () => {
    let history = emptyHistory()
    expect(browsing(history)).toBe(false)

    history = remember(history, 'hello')
    expect(browsing(history)).toBe(false)

    history = older(history, '')
    expect(browsing(history)).toBe(true)

    history = newer(history)
    expect(browsing(history)).toBe(false)
  })
})
