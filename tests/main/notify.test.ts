import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setNotifier, serversChanged } from '../../src/main/ipc/notify'

/**
 * Telling the window the servers changed underneath it.
 *
 * The window keeps its own copy of the server list and updates it as it acts,
 * which was right until something else acted: a paired phone reaches the same
 * handlers, and adopting a shared vault replaces the list wholesale. Neither
 * goes through the window, so it went on showing what was true when it loaded
 * — while the phone's own settings promised that anything changed there is
 * changed on both.
 */
describe('telling the window the servers changed', () => {
  beforeEach(() => setNotifier(null))

  it('names the change without describing it', () => {
    const sink = vi.fn()
    setNotifier(sink)

    serversChanged()

    // No diff, on purpose: the window re-reads, so there is one description of
    // the servers and it is the stored one.
    expect(sink).toHaveBeenCalledWith('servers:changed', undefined)
  })

  /**
   * A vault can be adopted, and servers written, before there is a window to
   * tell. Throwing there would take down startup over a notification.
   */
  it('does nothing at all when there is no window yet', () => {
    expect(() => serversChanged()).not.toThrow()
  })

  it('stops when the window goes away', () => {
    const sink = vi.fn()
    setNotifier(sink)
    setNotifier(null)

    serversChanged()

    expect(sink).not.toHaveBeenCalled()
  })
})
