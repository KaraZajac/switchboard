import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  DESKTOP_PRIORITY,
  DISCOVERY_CAP_MS,
  DISCOVERY_MS,
  PEER_GRACE_MS,
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_TIMEOUT_MS,
  PHONE_PRIORITY,
  SessionCoordinator,
  type SessionFrame
} from '../../src/main/session/coordinator'

/**
 * Two coordinators wired to each other through a link that can be cut, which is
 * the whole point: the interesting cases are the ones where the desktop goes
 * away and the phone has to decide whether it is now the connection.
 */
function harness() {
  const events: string[] = []
  let linked = true
  const running = new Set<string>()
  const deaf = new Set<string>()

  const make = (id: string, priority: number) => {
    const state = { resumed: 0, released: 0 }
    const peer = {
      id,
      state,
      coordinator: null as unknown as SessionCoordinator
    }

    peer.coordinator = new SessionCoordinator(
      priority,
      {
        send: (frame: SessionFrame) => {
          const otherId = id === 'desktop' ? 'phone' : 'desktop'
          if (!linked || !running.has(otherId) || deaf.has(otherId)) return
          const other = id === 'desktop' ? phone : desktop
          events.push(`${id} → ${frame.t}`)
          other.coordinator.handleFrame(id, frame)
        },
        hasPeers: () => linked && [...running].some((other) => other !== id)
      },
      {
        resume: () => {
          running.add(id)
          state.resumed++
          events.push(`${id} took the connections`)
        },
        release: () => {
          state.released++
          events.push(`${id} released the connections`)
        },
        vaultVersion: () => 3
      }
    )
    return peer
  }

  const desktop = make('desktop', DESKTOP_PRIORITY)
  const phone = make('phone', PHONE_PRIORITY)

  // Wrap start/stop so "is a peer present?" reflects who is actually running
  const wrap = (id: string, coordinator: SessionCoordinator): SessionCoordinator => {
    const start = coordinator.start.bind(coordinator)
    const stop = coordinator.stop.bind(coordinator)
    coordinator.start = () => {
      running.add(id)
      start()
    }
    coordinator.stop = () => {
      running.delete(id)
      stop()
    }
    return coordinator
  }

  wrap('desktop', desktop.coordinator)
  wrap('phone', phone.coordinator)

  return {
    desktop,
    phone,
    events,
    /** The desktop relaunching: a new coordinator with the same identity */
    restartDesktop: () => {
      desktop.coordinator.stop()
      desktop.coordinator = wrap('desktop', make('desktop', DESKTOP_PRIORITY).coordinator)
      return desktop.coordinator
    },
    /** Frames to this peer stop arriving, as if it had stopped listening */
    deafen: (id: string) => deaf.add(id),
    cut: () => {
      linked = false
    },
    restore: () => {
      linked = true
    }
  }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('who holds the connection', () => {
  it('a device on its own is the connection', () => {
    const { desktop } = harness()
    desktop.coordinator.start()
    expect(desktop.coordinator.state().role).toBe('primary')
  })

  it('the phone becomes a follower when the desktop is up', () => {
    const { desktop, phone } = harness()
    desktop.coordinator.start()
    phone.coordinator.start()

    // The desktop's heartbeat reaches the phone
    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS)

    expect(phone.coordinator.state().role).toBe('follower')
    expect(desktop.coordinator.state().role).toBe('primary')
    expect(phone.state.resumed).toBe(0)
  })

  it('the phone takes over when the desktop stops beating', () => {
    const { desktop, phone, cut } = harness()
    desktop.coordinator.start()
    phone.coordinator.start()
    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS)
    expect(phone.coordinator.state().role).toBe('follower')

    // Desktop disappears — no more heartbeats reach the phone
    cut()
    desktop.coordinator.stop()
    vi.advanceTimersByTime(HEARTBEAT_TIMEOUT_MS + HEARTBEAT_INTERVAL_MS)

    expect(phone.coordinator.state().role).toBe('primary')
    expect(phone.state.resumed).toBeGreaterThan(0)
  })

  it('does not take over early — a slow beat is not a dead desktop', () => {
    const { desktop, phone, cut } = harness()
    desktop.coordinator.start()
    phone.coordinator.start()
    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS)

    cut()
    desktop.coordinator.stop()
    vi.advanceTimersByTime(HEARTBEAT_TIMEOUT_MS - 1000)

    expect(phone.coordinator.state().role).toBe('follower')
  })

  it('hands back when the desktop returns, releasing before the desktop connects', () => {
    const { desktop, phone, cut, restore, restartDesktop, events } = harness()
    desktop.coordinator.start()
    phone.coordinator.start()
    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS)

    cut()
    desktop.coordinator.stop()
    vi.advanceTimersByTime(HEARTBEAT_TIMEOUT_MS + HEARTBEAT_INTERVAL_MS)
    expect(phone.coordinator.state().role).toBe('primary')

    events.length = 0
    restore()
    // The desktop comes back as a fresh process: it must look before it leaps
    restartDesktop()
    desktop.coordinator.start()
    expect(desktop.coordinator.state().role).toBe('follower')
    vi.advanceTimersByTime(DISCOVERY_MS + HEARTBEAT_INTERVAL_MS * 3)

    expect(desktop.coordinator.state().role).toBe('primary')
    expect(phone.coordinator.state().role).toBe('follower')

    // The order matters: the phone must be off the network before the desktop
    // joins it, or the user is connected twice.
    const released = events.indexOf('phone released the connections')
    const took = events.indexOf('desktop took the connections')
    expect(released).toBeGreaterThanOrEqual(0)
    expect(took).toBeGreaterThan(released)
  })

  it('never leaves both devices holding the connections', () => {
    const { desktop, phone, cut, restore } = harness()
    desktop.coordinator.start()
    phone.coordinator.start()

    const bothPrimary = () =>
      desktop.coordinator.state().role === 'primary' &&
      phone.coordinator.state().role === 'primary'

    for (let step = 0; step < 20; step++) {
      vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS)
      // While the link is up, only one of them may be primary
      if (step === 5) cut()
      if (step === 15) restore()
      if (step < 5 || step > 17) expect(bothPrimary()).toBe(false)
    }
  })

  it('claims the connection back from a phone that is holding it', () => {
    const { desktop, phone } = harness()
    phone.coordinator.start() // alone, so it holds the connections
    expect(phone.coordinator.state().role).toBe('primary')

    desktop.coordinator.start()
    expect(desktop.coordinator.state().role).toBe('follower') // looks first
    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS)

    expect(desktop.coordinator.state().role).toBe('primary')
    expect(phone.coordinator.state().role).toBe('follower')
    expect(phone.state.released).toBe(1)
  })

  it('takes over anyway when a claim goes unanswered', () => {
    const { desktop, phone, deafen } = harness()
    phone.coordinator.start()
    desktop.coordinator.start()

    // The phone is still beating but has stopped listening: our claim to take
    // the connection back never reaches it.
    deafen('phone')
    desktop.coordinator.handleFrame('phone', {
      t: 'heartbeat',
      role: 'primary',
      priority: PHONE_PRIORITY,
      since: new Date().toISOString(),
      vaultVersion: 3
    })
    expect(desktop.coordinator.state().claiming).toBe(true)

    vi.advanceTimersByTime(HEARTBEAT_TIMEOUT_MS + 1000)
    expect(desktop.coordinator.state().role).toBe('primary')
  })

  it('reports the vault version in its heartbeats, so a stale peer can tell', () => {
    const { desktop, phone } = harness()
    desktop.coordinator.start()
    phone.coordinator.start()
    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS)

    expect(phone.coordinator.state().vaultVersion).toBe(3)
    expect(Object.keys(phone.coordinator.state().peers)).toContain('desktop')
  })
})

describe('being visible to the other device', () => {
  it('a follower keeps beating, so the primary can see it', () => {
    const { desktop, phone } = harness()
    desktop.coordinator.start()
    phone.coordinator.start()
    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS)
    expect(phone.coordinator.state().role).toBe('follower')

    // Several beats later the desktop should still know the phone is there
    vi.advanceTimersByTime(HEARTBEAT_TIMEOUT_MS + HEARTBEAT_INTERVAL_MS)

    const peers = desktop.coordinator.state().peers
    expect(Object.keys(peers)).toContain('phone')
    expect(peers.phone.role).toBe('follower')
    expect(desktop.coordinator.state().role).toBe('primary')
  })

  it('a follower beating does not unseat the primary', () => {
    const { desktop, phone } = harness()
    desktop.coordinator.start()
    phone.coordinator.start()

    for (let step = 0; step < 10; step++) {
      vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS)
      expect(desktop.coordinator.state().role).toBe('primary')
      expect(phone.state.released).toBe(0)
    }
  })
})

describe('coming back to a phone that took over', () => {
  it('holds off while a peer is dialling in, then lets it hand over first', () => {
    const { desktop, phone, cut, restore, restartDesktop, events } = harness()
    desktop.coordinator.start()
    phone.coordinator.start()
    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS)

    cut()
    desktop.coordinator.stop()
    vi.advanceTimersByTime(HEARTBEAT_TIMEOUT_MS + HEARTBEAT_INTERVAL_MS)
    expect(phone.coordinator.state().role).toBe('primary')

    events.length = 0
    restore()
    restartDesktop()
    desktop.coordinator.start()

    // The phone's link comes back part-way through the window, and its
    // heartbeat says it is the one holding the connections
    vi.advanceTimersByTime(DISCOVERY_MS - 2000)
    desktop.coordinator.peerConnected('phone')
    vi.advanceTimersByTime(PEER_GRACE_MS + HEARTBEAT_INTERVAL_MS * 3)

    expect(desktop.coordinator.state().role).toBe('primary')
    expect(phone.coordinator.state().role).toBe('follower')

    // The phone must be off the network before the desktop joins it
    const released = events.indexOf('phone released the connections')
    const took = events.indexOf('desktop took the connections')
    expect(released).toBeGreaterThanOrEqual(0)
    expect(took).toBeGreaterThan(released)
  })

  it('a peer arriving after the window still ends with exactly one primary', () => {
    const { desktop, phone, cut, restore, restartDesktop } = harness()
    desktop.coordinator.start()
    phone.coordinator.start()
    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS)

    cut()
    desktop.coordinator.stop()
    vi.advanceTimersByTime(HEARTBEAT_TIMEOUT_MS + HEARTBEAT_INTERVAL_MS)

    restartDesktop()
    desktop.coordinator.start()
    // Nobody answers in time, so the desktop concludes it is alone
    vi.advanceTimersByTime(DISCOVERY_MS + HEARTBEAT_INTERVAL_MS)
    expect(desktop.coordinator.state().role).toBe('primary')

    // …and only then does the phone get its link back, still holding
    restore()
    desktop.coordinator.peerConnected('phone')
    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS * 5)

    expect(desktop.coordinator.state().role).toBe('primary')
    expect(phone.coordinator.state().role).toBe('follower')
    expect(phone.state.released).toBeGreaterThan(0)
  })

  it('gives up looking eventually, so a phone that is off does not block it', () => {
    const { desktop } = harness()
    // A paired-but-absent device: hasPeers() is true, nothing ever answers
    desktop.coordinator.start()

    vi.advanceTimersByTime(DISCOVERY_CAP_MS + HEARTBEAT_INTERVAL_MS * 2)
    expect(desktop.coordinator.state().role).toBe('primary')
  })
})

describe('leaving on purpose', () => {
  it('takes over at once when the primary says goodbye', () => {
    const { desktop, phone } = harness()
    desktop.coordinator.start()
    phone.coordinator.start()
    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS)
    expect(phone.coordinator.state().role).toBe('follower')

    // Closing the desktop deliberately should not cost the user sixteen
    // seconds of being connected to nothing
    desktop.coordinator.leave()

    expect(phone.coordinator.state().role).toBe('primary')
    expect(phone.state.resumed).toBeGreaterThan(0)
  })

  it('a goodbye from a follower changes nothing about who is primary', () => {
    const { desktop, phone } = harness()
    desktop.coordinator.start()
    phone.coordinator.start()
    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS)

    phone.coordinator.leave()

    expect(desktop.coordinator.state().role).toBe('primary')
    expect(desktop.state.released).toBe(0)
  })

  it('stops beating after saying goodbye', () => {
    const { desktop, phone, events } = harness()
    desktop.coordinator.start()
    phone.coordinator.start()
    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS)

    desktop.coordinator.leave()
    events.length = 0
    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS * 4)

    expect(events.filter((e) => e.startsWith('desktop →'))).toEqual([])
  })
})
