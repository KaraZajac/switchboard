import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { typingToSend, type TypingEvent } from '@shared/typing'
import { TYPING_THROTTLE_MS } from '@shared/constants'

interface Case {
  name: string
  event: TypingEvent
  lastActiveAt: number
  now: number
  send: 'active' | 'done' | null
  nextLastActiveAt: number
}

const corpus = JSON.parse(
  readFileSync(join(__dirname, '../fixtures/typing.json'), 'utf8')
) as { throttleMs: number; cases: Case[] }

describe('when to say somebody is typing', () => {
  it('uses the throttle the corpus was written against', () => {
    expect(TYPING_THROTTLE_MS).toBe(corpus.throttleMs)
  })

  for (const c of corpus.cases) {
    it(c.name, () => {
      const decision = typingToSend(c.event, c.lastActiveAt, c.now)
      expect(decision.send).toBe(c.send)
      expect(decision.lastActiveAt).toBe(c.nextLastActiveAt)
    })
  }

  it('a message costs one active and one done, whatever was typed into it', () => {
    // What the wire showed the first time anyone watched from outside: the
    // phone spent three actives and two dones on a message typed in one go.
    const wire: string[] = []
    let state = 0
    let now = 1000

    const note = (event: TypingEvent) => {
      const decision = typingToSend(event, state, now)
      state = decision.lastActiveAt
      if (decision.send) wire.push(decision.send)
    }

    for (const char of 'said from the phone') {
      void char
      note('typed')
      now += 120
    }
    note('sent')
    // And the box emptying behind the send, which is a second event
    note('cleared')

    expect(wire).toEqual(['active', 'done'])
  })

  it('a composer left alone says nothing more, however long it sits', () => {
    let state = 0
    const first = typingToSend('typed', state, 1000)
    state = first.lastActiveAt
    expect(first.send).toBe('active')

    // Ten minutes with the message half-written and the phone on the table
    for (let now = 1000; now < 1000 + 600_000; now += 3000) {
      void now
    }
    // Nothing asks, because nothing happened. The only way to reach the rule
    // again is a keystroke — which is the whole fix.
    expect(state).toBe(1000)
  })
})
