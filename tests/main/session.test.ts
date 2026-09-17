import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  DESKTOP_PRIORITY,
  DISCOVERY_CAP_MS,
  DISCOVERY_MS,
  PEER_GRACE_MS,
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_TIMEOUT_MS,
  PHONE_PRIORITY,
  TRANSPORT_GRACE_MS,
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
    // `holds` is the networks this device has open, which is what a heartbeat
    // advertises and what the other device has to dial when it takes over.
    // `resumedWith` records what it was told to take, at the moment it took it.
    const state = {
      resumed: 0,
      released: 0,
      holds: new Set<string>(),
      resumedWith: [] as string[]
    }
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
          state.resumedWith = peer.coordinator.heldByPeers()
          for (const serverId of state.resumedWith) state.holds.add(serverId)
          events.push(`${id} took the connections`)
        },
        release: () => {
          state.released++
          state.holds.clear()
          events.push(`${id} released the connections`)
        },
        vaultVersion: () => 3,
        holding: () => [...state.holds]
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
      desktop.coordinator.state().role === 'primary' && phone.coordinator.state().role === 'primary'

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

/**
 * What each device has open, and who dials it after a handover.
 *
 * The two halves of this were separately broken and each looked fine from the
 * device it was broken on. The phone took over from a desktop and connected to
 * nothing, because it dialled only networks marked "connect automatically" —
 * and the one in use was not, having been connected by hand. Then the desktop
 * came back, the phone dutifully released a working connection, and the
 * desktop showed "Not connected": it had restarted in the meantime, so its own
 * record of what it had released was gone with the process that held it.
 *
 * Between them, a conversation that was live on one device could end up live
 * on neither, with both devices showing exactly what a correct handover looks
 * like.
 */
describe('taking over what the other device actually had', () => {
  it('tells a device taking over which networks the other one was holding', () => {
    const { desktop, phone, cut } = harness()

    desktop.coordinator.start()
    phone.coordinator.start()
    vi.advanceTimersByTime(DISCOVERY_MS + HEARTBEAT_INTERVAL_MS)

    // The desktop is holding one network, which nothing here calls autoConnect
    desktop.state.holds.add('ergo')
    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS)

    cut()
    vi.advanceTimersByTime(HEARTBEAT_TIMEOUT_MS + HEARTBEAT_INTERVAL_MS)

    expect(phone.coordinator.state().role).toBe('primary')
    expect(phone.state.resumedWith).toEqual(['ergo'])
  })

  it('and remembers it after that device is gone, which is when it is needed', () => {
    const { desktop, phone, cut } = harness()

    desktop.coordinator.start()
    phone.coordinator.start()
    vi.advanceTimersByTime(DISCOVERY_MS + HEARTBEAT_INTERVAL_MS)
    desktop.state.holds.add('ergo')
    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS)

    cut()
    vi.advanceTimersByTime(HEARTBEAT_TIMEOUT_MS + HEARTBEAT_INTERVAL_MS)

    // Long after the desktop stopped beating, the answer is still there
    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS * 20)
    expect(phone.coordinator.heldByPeers()).toEqual(['ergo'])
  })

  it('hands over a network it was already on when the other device arrived', () => {
    const { desktop, phone, events } = harness()

    // The phone dialled this itself — over a link that did not exist yet, or
    // from an irc:// link — and only then does the desktop turn up.
    desktop.coordinator.start()
    phone.state.holds.add('netslum')
    phone.coordinator.start()
    vi.advanceTimersByTime(DISCOVERY_MS + HEARTBEAT_INTERVAL_MS * 2)

    expect(phone.coordinator.state().role).toBe('follower')
    expect(phone.state.released).toBe(1)
    expect([...phone.state.holds]).toEqual([])
    expect(events).toContain('phone released the connections')
  })

  it('hands over once, however long the two sit there', () => {
    const { desktop, phone } = harness()

    desktop.coordinator.start()
    phone.state.holds.add('netslum')
    phone.coordinator.start()
    vi.advanceTimersByTime(DISCOVERY_MS + HEARTBEAT_INTERVAL_MS * 20)

    // Releasing on every heartbeat would forget what was released, and with it
    // what to dial when this device takes the connections back
    expect(phone.state.released).toBe(1)
  })

  it('hands over again after a spell of holding them', () => {
    const { desktop, phone } = harness()

    desktop.coordinator.start()
    phone.coordinator.start()
    vi.advanceTimersByTime(DISCOVERY_MS + HEARTBEAT_INTERVAL_MS)

    // The desktop goes, the phone takes over, the desktop comes back
    desktop.coordinator.stop()
    vi.advanceTimersByTime(HEARTBEAT_TIMEOUT_MS + HEARTBEAT_INTERVAL_MS * 2)
    expect(phone.coordinator.state().role).toBe('primary')

    desktop.coordinator.start()
    vi.advanceTimersByTime(DISCOVERY_CAP_MS + HEARTBEAT_INTERVAL_MS * 4)

    expect(phone.coordinator.state().role).toBe('follower')
    expect([...phone.state.holds]).toEqual([])
  })

  it('a follower is not asked what it is holding, because it is holding nothing', () => {
    const { desktop, phone } = harness()

    desktop.coordinator.start()
    phone.coordinator.start()
    vi.advanceTimersByTime(DISCOVERY_MS + HEARTBEAT_INTERVAL_MS)

    // A follower that still had a stale set would hand the desktop a list of
    // networks nobody is on
    phone.state.holds.add('stale')
    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS * 2)

    expect(phone.coordinator.state().role).toBe('follower')
    expect(desktop.coordinator.heldByPeers()).toEqual([])
  })
})

describe('telling the transport a peer is gone', () => {
  it('says so at the heartbeat timeout, not at the socket timeout', () => {
    const expired: string[] = []
    const coordinator = new SessionCoordinator(
      DESKTOP_PRIORITY,
      {
        send: () => {},
        hasPeers: () => true,
        peerExpired: (id) => expired.push(id)
      },
      { resume: () => {}, release: () => {}, vaultVersion: () => 1, holding: () => [] }
    )

    coordinator.start()
    coordinator.handleFrame('gone-soon', {
      t: 'heartbeat',
      role: 'primary',
      priority: 1000,
      since: null,
      vaultVersion: 1
    })

    // Three missed beats. A QUIC connection to a machine that has restarted
    // takes longer than this to fail, and a transport that can redial wants to
    // start now rather than then.
    vi.advanceTimersByTime(HEARTBEAT_TIMEOUT_MS + HEARTBEAT_INTERVAL_MS)

    expect(expired).toEqual(['gone-soon'])
    coordinator.stop()
  })

  it('says nothing about a peer that is still beating', () => {
    const expired: string[] = []
    const coordinator = new SessionCoordinator(
      DESKTOP_PRIORITY,
      {
        send: () => {},
        hasPeers: () => true,
        peerExpired: (id) => expired.push(id)
      },
      { resume: () => {}, release: () => {}, vaultVersion: () => 1, holding: () => [] }
    )

    coordinator.start()
    for (let beat = 0; beat < 6; beat++) {
      coordinator.handleFrame('steady', {
        t: 'heartbeat',
        role: 'primary',
        priority: 1000,
        since: null,
        vaultVersion: 1
      })
      vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS)
    }

    expect(expired).toEqual([])
    coordinator.stop()
  })
})

/**
 * Three devices that do not all see each other.
 *
 * The phone is paired to the desktop, the desktop to the always-on instance,
 * and nothing pairs the phone to the always-on instance — which is exactly how
 * somebody arrives at three, one pairing at a time. The phone can see one peer,
 * a follower, and has to work out from that alone that the network is already
 * being held.
 */
function chain() {
  const links = new Map<string, Set<string>>()
  const nodes = new Map<string, { coordinator: SessionCoordinator; connections: number }>()

  const make = (id: string, priority: number, reaches: string[]) => {
    links.set(id, new Set(reaches))
    const node = { coordinator: null as unknown as SessionCoordinator, connections: 0 }

    node.coordinator = new SessionCoordinator(
      priority,
      {
        send: (frame: SessionFrame, peerId?: string) => {
          for (const other of links.get(id) ?? []) {
            if (peerId && peerId !== other) continue
            nodes.get(other)?.coordinator.handleFrame(id, frame)
          }
        },
        hasPeers: () => (links.get(id)?.size ?? 0) > 0
      },
      {
        resume: () => {
          node.connections++
        },
        release: () => {
          node.connections--
        },
        vaultVersion: () => 1,
        holding: () => []
      }
    )

    nodes.set(id, node)
    return node
  }

  return { make, nodes, links }
}

describe('three devices, only two of them paired to each other', () => {
  it('does not put the phone on the network beside an instance it cannot see', () => {
    const { make } = chain()
    const server = make('server', 1000, ['desktop'])
    const desktop = make('desktop', DESKTOP_PRIORITY, ['server', 'phone'])
    const phone = make('phone', PHONE_PRIORITY, ['desktop'])

    server.coordinator.start()
    desktop.coordinator.start()
    phone.coordinator.start()

    // Long enough for every discovery window to close and for the phone to
    // have concluded, wrongly, that nobody was holding anything
    vi.advanceTimersByTime(DISCOVERY_CAP_MS + HEARTBEAT_TIMEOUT_MS * 2)

    expect({
      server: server.coordinator.state().role,
      desktop: desktop.coordinator.state().role,
      phone: phone.coordinator.state().role
    }).toEqual({ server: 'primary', desktop: 'follower', phone: 'follower' })

    server.coordinator.stop()
    desktop.coordinator.stop()
    phone.coordinator.stop()
  })

  it('lets the phone take over when the whole chain above it is gone', () => {
    const { make, links } = chain()
    const server = make('server', 1000, ['desktop'])
    const desktop = make('desktop', DESKTOP_PRIORITY, ['server', 'phone'])
    const phone = make('phone', PHONE_PRIORITY, ['desktop'])

    server.coordinator.start()
    desktop.coordinator.start()
    phone.coordinator.start()
    vi.advanceTimersByTime(DISCOVERY_CAP_MS + HEARTBEAT_INTERVAL_MS * 2)
    expect(phone.coordinator.state().role).toBe('follower')

    // Both of the others go away. Holding off forever would be the opposite
    // failure: a phone that will not connect because of a desktop that is not
    // there.
    links.set('phone', new Set())
    links.set('desktop', new Set())
    server.coordinator.stop()
    desktop.coordinator.stop()

    vi.advanceTimersByTime(HEARTBEAT_TIMEOUT_MS + HEARTBEAT_INTERVAL_MS * 2)

    expect(phone.coordinator.state().role).toBe('primary')
    phone.coordinator.stop()
  })

  it('hands the phone to the desktop when only the always-on instance goes', () => {
    const { make, links } = chain()
    const server = make('server', 1000, ['desktop'])
    const desktop = make('desktop', DESKTOP_PRIORITY, ['server', 'phone'])
    const phone = make('phone', PHONE_PRIORITY, ['desktop'])

    server.coordinator.start()
    desktop.coordinator.start()
    phone.coordinator.start()
    vi.advanceTimersByTime(DISCOVERY_CAP_MS + HEARTBEAT_INTERVAL_MS * 2)

    links.set('desktop', new Set(['phone']))
    server.coordinator.stop()

    vi.advanceTimersByTime(HEARTBEAT_TIMEOUT_MS + HEARTBEAT_INTERVAL_MS * 2)

    // Exactly one of them, and it is the better one
    expect(desktop.coordinator.state().role).toBe('primary')
    expect(phone.coordinator.state().role).toBe('follower')

    desktop.coordinator.stop()
    phone.coordinator.stop()
  })
})

/**
 * A phone's link does not stay up, and is not meant to.
 *
 * Android freezes a backgrounded process and the QUIC connection goes with it;
 * the phone redials a second later. Reported as "the phone says live and the
 * desktop says live and they are both paired", with the desktop's own log
 * showing the cycle twenty times in twenty-six minutes:
 *
 *     Remote link stream error: ConnectionLost(LocallyClosed)
 *     Paired device connected: XQ-CT62
 *     Stored 1 message(s) handed over by a paired device
 *
 * Each one used to be an election. The peer was deleted the moment the socket
 * went, so the phone concluded the desktop had gone and took the connections;
 * the desktop's next heartbeat took them back. The heartbeat timeout exists to
 * answer this question and was never asked.
 */
describe('a link that drops and comes straight back', () => {
  const beat = (
    coordinator: SessionCoordinator,
    id: string,
    priority: number,
    role: 'primary' | 'follower' = 'primary'
  ): void =>
    coordinator.handleFrame(id, {
      t: 'heartbeat',
      role,
      priority,
      since: null,
      vaultVersion: 1
    })

  /** A phone following a desktop, with the desktop's heartbeat received */
  function following() {
    const resumed: string[] = []
    const coordinator = new SessionCoordinator(
      PHONE_PRIORITY,
      { send: () => {}, hasPeers: () => true },
      {
        resume: () => resumed.push('resumed'),
        release: () => {},
        vaultVersion: () => 1,
        holding: () => []
      }
    )
    coordinator.start()
    // Beating the whole way through discovery, the way a desktop that is
    // actually there does — one heartbeat and then twenty seconds of silence
    // is a desktop that has gone.
    for (let waited = 0; waited <= DISCOVERY_CAP_MS; waited += HEARTBEAT_INTERVAL_MS) {
      beat(coordinator, 'desktop', DESKTOP_PRIORITY)
      vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS)
    }
    expect(coordinator.state().role).toBe('follower')
    return { coordinator, resumed }
  }

  it('does not make the phone take the connections', () => {
    const { coordinator, resumed } = following()

    // The socket goes, and the phone is back on the link a second later
    coordinator.peerGone('desktop')
    vi.advanceTimersByTime(1_000)
    coordinator.peerConnected('desktop')
    beat(coordinator, 'desktop', DESKTOP_PRIORITY)
    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS * 2)

    expect(coordinator.state().role).toBe('follower')
    expect(resumed, 'nothing changed hands').toEqual([])
  })

  it('survives it happening over and over', () => {
    const { coordinator, resumed } = following()

    // Twenty blips a minute apart, which is the reported shape
    for (let i = 0; i < 20; i++) {
      coordinator.peerGone('desktop')
      vi.advanceTimersByTime(1_500)
      coordinator.peerConnected('desktop')
      // A minute of ordinary heartbeats before the next blip
      for (let waited = 1_500; waited < 60_000; waited += HEARTBEAT_INTERVAL_MS) {
        beat(coordinator, 'desktop', DESKTOP_PRIORITY)
        vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS)
      }
    }

    expect(coordinator.state().role).toBe('follower')
    expect(resumed).toEqual([])
  })

  it('but still takes over when the desktop does not come back', () => {
    const { coordinator, resumed } = following()

    coordinator.peerGone('desktop')
    // The grace, and then long enough for a tick to notice
    vi.advanceTimersByTime(TRANSPORT_GRACE_MS + HEARTBEAT_INTERVAL_MS * 2)

    expect(coordinator.state().role).toBe('primary')
    expect(resumed).toEqual(['resumed'])
  })

  it('and does not wind a long-silent peer forward by losing its socket too', () => {
    const { coordinator } = following()

    // Quiet for longer than the grace already. Losing the socket on top of
    // that must not buy it another few seconds.
    vi.advanceTimersByTime(HEARTBEAT_TIMEOUT_MS - 1_000)
    coordinator.peerGone('desktop')
    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS * 2)

    expect(coordinator.state().role).toBe('primary')
  })
})
