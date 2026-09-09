import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  setNotifier,
  serversChanged,
  monitorChanged,
  settingChanged,
  readMarkerChanged
} from '../../src/main/ipc/notify'

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

/**
 * The same shape of gap, in the other places the phone can reach.
 *
 * Each of these is state the window reads once and then keeps, where the IRC
 * server either says nothing back or says something else.
 */
describe('the other things a phone can change', () => {
  beforeEach(() => setNotifier(null))

  /**
   * MONITOR echoes who is online. It never says who is on the list, so a
   * friend added elsewhere stayed invisible here — and their online notice
   * arrived for a nick this window did not think it was watching.
   */
  it('names the network whose watched list changed', () => {
    const sink = vi.fn()
    setNotifier(sink)

    monitorChanged('server-1')

    expect(sink).toHaveBeenCalledWith('monitor:changed', { serverId: 'server-1' })
  })

  /** The theme is shared between the two clients on purpose */
  it('names the setting that changed', () => {
    const sink = vi.fn()
    setNotifier(sink)

    settingChanged('theme')

    expect(sink).toHaveBeenCalledWith('settings:changed', { key: 'theme' })
  })

  /**
   * Deliberately the same event the server's own MARKREAD echo produces: it is
   * the same fact, and the window should not need two ways to hear it.
   */
  it('reports a read marker as the server would have', () => {
    const sink = vi.fn()
    setNotifier(sink)

    readMarkerChanged('server-1', '#lounge', '2026-09-09T03:00:00Z')

    expect(sink).toHaveBeenCalledWith('irc:read-marker', {
      serverId: 'server-1',
      channel: '#lounge',
      timestamp: '2026-09-09T03:00:00Z'
    })
  })
})
