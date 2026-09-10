import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Noticing that a message did not go.
 *
 * Every send site ignored the promise `invoke` returns, so a message typed
 * while the connection was down became an unhandled rejection: the composer
 * emptied, nothing appeared, and nothing anywhere said why. Losing what
 * somebody typed is the worst thing a chat client can do quietly.
 */
const toasts = vi.hoisted(() => ({ shown: [] as { title: string; body: string }[] }))

vi.mock('../../src/renderer/stores/uiStore', () => ({
  useUIStore: {
    getState: () => ({
      addToast: (t: { title: string; body: string }) => toasts.shown.push(t)
    })
  }
}))

const { speak } = await import('../../src/renderer/utils/speak')

beforeEach(() => {
  toasts.shown = []
})

describe('saying something that did not go', () => {
  it('says nothing when it went', async () => {
    speak(Promise.resolve())
    await new Promise((r) => setTimeout(r, 0))

    expect(toasts.shown).toEqual([])
  })

  it('shows the reason the main process gave', async () => {
    speak(Promise.reject(new Error('Not connected')))
    await new Promise((r) => setTimeout(r, 0))

    expect(toasts.shown).toHaveLength(1)
    expect(toasts.shown[0].body).toBe('Not connected')
  })

  /**
   * Electron wraps a thrown Error with its own preamble. The sentence the main
   * process actually wrote is the only part worth showing anybody.
   */
  it('strips the wrapper Electron puts round a rejection', async () => {
    speak(
      Promise.reject(
        new Error("Error invoking remote method 'message:send': Error: Not connected")
      )
    )
    await new Promise((r) => setTimeout(r, 0))

    expect(toasts.shown[0].body).toBe('Not connected')
  })

  it('carries the caller’s description of what failed', async () => {
    speak(Promise.reject(new Error('Not connected')), 'That edit did not go')
    await new Promise((r) => setTimeout(r, 0))

    expect(toasts.shown[0].title).toBe('That edit did not go')
  })

  it('survives a rejection that is not an Error', async () => {
    speak(Promise.reject('something odd'))
    await new Promise((r) => setTimeout(r, 0))

    expect(toasts.shown[0].body).toBe('something odd')
  })
})
