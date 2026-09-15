import { describe, it, expect, beforeEach, vi } from 'vitest'

// The store reads remembered preferences and paints the theme as it loads.
// This file is about what it does afterwards, so both are stood in for rather
// than pulling a whole DOM in for one store.
vi.stubGlobal('localStorage', {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {}
})
vi.stubGlobal('document', { documentElement: { setAttribute: () => {}, style: { setProperty: () => {} } } })

const { useUIStore } = await import('../../src/renderer/stores/uiStore')

/**
 * Where Messages reopens.
 *
 * Choosing a network already reopens the channel you were reading on it —
 * the active channel is kept per server. Messages had no such memory, so
 * coming back to it landed on an empty pane however recently you had been
 * reading there.
 */

beforeEach(() => {
  useUIStore.setState({ dmMode: false, lastDm: null })
})

describe('the conversation Messages was left on', () => {
  it('is nothing before one has been opened', () => {
    expect(useUIStore.getState().lastDm).toBeNull()
  })

  it('is remembered when one is opened', () => {
    useUIStore.getState().rememberDm('srv', 'robin')

    expect(useUIStore.getState().lastDm).toEqual({ serverId: 'srv', nick: 'robin' })
  })

  it('moves to whichever was opened last', () => {
    useUIStore.getState().rememberDm('srv', 'robin')
    useUIStore.getState().rememberDm('other', 'mara')

    expect(useUIStore.getState().lastDm).toEqual({ serverId: 'other', nick: 'mara' })
  })

  it('survives going to a network and back', () => {
    useUIStore.getState().rememberDm('srv', 'robin')
    useUIStore.getState().setDmMode(false)
    useUIStore.getState().setDmMode(true)

    expect(useUIStore.getState().lastDm).toEqual({ serverId: 'srv', nick: 'robin' })
  })
})
