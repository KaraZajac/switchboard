import { describe, it, expect, beforeEach, vi } from 'vitest'

// The store reads remembered preferences and paints the theme as it loads.
// This file is about what it does afterwards, so both are stood in for.
vi.stubGlobal('localStorage', {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {}
})
vi.stubGlobal('document', {
  documentElement: { setAttribute: () => {}, style: { setProperty: () => {} } }
})

const { useUIStore } = await import('../../src/renderer/stores/uiStore')

/**
 * How much of the window a server is allowed to take.
 *
 * The text of most of these is written by the far end — a refusal, a failed
 * login, a certificate complaint — and a line off the wire can be sixteen
 * kilobytes. They stack upwards from the bottom right corner, so past a few of
 * them the oldest are off the top of the window with their dismiss buttons out
 * of reach, and one long enough does it on its own.
 *
 * The same news twice was already one toast. This is the rest of it: a server
 * with a different complaint every second, and a server with one very long
 * one. The height is the component's business (`max-h` and a scrollbar); the
 * count is here.
 */
beforeEach(() => {
  useUIStore.setState({ toasts: [] })
})

const say = (body: string, title = 'Server') =>
  useUIStore.getState().addToast({ title, body })

describe('the toast stack', () => {
  it('shows what it is told', () => {
    say('one')
    expect(useUIStore.getState().toasts.map((t) => t.body)).toEqual(['one'])
  })

  it('does not stack the same news twice', () => {
    say('the same thing')
    say('the same thing')
    expect(useUIStore.getState().toasts).toHaveLength(1)
  })

  it('keeps the newest few and lets the rest go', () => {
    for (const n of [1, 2, 3, 4, 5, 6, 7]) say(`complaint ${n}`)

    const showing = useUIStore.getState().toasts
    expect(showing).toHaveLength(4)
    expect(showing.map((t) => t.body)).toEqual([
      'complaint 4',
      'complaint 5',
      'complaint 6',
      'complaint 7'
    ])
  })

  it('still has room for the one that matters after a flood', () => {
    // The point of the cap: a login that failed asks a question and offers the
    // way in, and it is worth nothing behind six refusals off the top of the
    // screen
    for (const n of [1, 2, 3, 4, 5, 6]) say(`noise ${n}`)
    useUIStore.getState().addToast({
      title: 'Logging in failed',
      body: 'Invalid password',
      action: { kind: 'account', label: 'Log in', serverId: 's1' },
      sticky: true
    })

    const showing = useUIStore.getState().toasts
    expect(showing).toHaveLength(4)
    expect(showing.at(-1)?.title).toBe('Logging in failed')
  })

  it('keeps a long one rather than cutting it, because the text is the answer', () => {
    // Bounded on screen by the component, not by throwing the words away
    const huge = 'A refusal from a server that does not know when to stop. '.repeat(300)
    say(huge)
    expect(useUIStore.getState().toasts[0].body).toBe(huge)
  })
})
