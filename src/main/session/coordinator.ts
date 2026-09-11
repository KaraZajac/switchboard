/** What the coordinator needs from the IRC layer, injected so it stays testable */
export interface ConnectionControl {
  /** Take the connections: this device is now the one on the network */
  resume: () => void
  /** Give them up: another device is taking over */
  release: () => void
  /** Current vault version, advertised in heartbeats */
  vaultVersion: () => number
  /**
   * The networks this device is holding right now, advertised in heartbeats.
   *
   * Taking over is not a cold start. Whichever device wins has to dial what
   * the other one actually had, and neither can work that out alone: a device
   * that has just restarted has no memory of it, and `autoConnect` answers a
   * different question — "dial this on launch" — so a network somebody
   * connected by hand was dropped by whoever took over and never dialled
   * again. Both sides looked like they had handed over correctly.
   */
  holding: () => string[]
}

/**
 * Which device is holding the IRC connections.
 *
 * Two devices, one identity: only one of them may be connected to the network
 * at a time, or the user turns up twice and the nick collides. So exactly one
 * peer is `primary` — it holds the sockets and serves the other — and the rest
 * are `follower`s that proxy through it.
 *
 * The desktop outranks the phone. When the desktop disappears the phone waits
 * for the heartbeat to lapse, takes over using the shared vault, and hands back
 * when the desktop returns. A device with no peer at all is simply primary.
 */

export type SessionRole = 'primary' | 'follower'

/** Higher wins. A desktop is a better host than a phone: mains power, no Doze. */
export const DESKTOP_PRIORITY = 100
export const PHONE_PRIORITY = 10

export const HEARTBEAT_INTERVAL_MS = 5_000
/** Three missed beats before a follower concludes the primary is gone */
export const HEARTBEAT_TIMEOUT_MS = 16_000
/**
 * How long a starting device listens before assuming it is the connection.
 *
 * Starting as primary would put a returning desktop on the network while the
 * phone that took over is still there — both connected, nick collision, exactly
 * the mess the coordinator exists to prevent.
 */
export const DISCOVERY_MS = 6_000

/**
 * Extra grace once a peer actually connects during discovery.
 *
 * A device coming back finds its peers still dialling in: the link is a fresh
 * QUIC connection and takes a moment. Deciding before their first heartbeat
 * lands means concluding nobody is there while somebody is — and the returning
 * desktop joins the network beside the phone, under `nick_`. Once a peer is on
 * the link its heartbeat is milliseconds away, so this only has to be long
 * enough to cover that.
 */
export const PEER_GRACE_MS = 3_000

/** The longest a device will hold off connecting while it looks around */
export const DISCOVERY_CAP_MS = 20_000

export interface SessionState {
  role: SessionRole
  priority: number
  /** When this device last became primary */
  since: string | null
  /** Peers we can currently see, by device id */
  peers: Record<string, { role: SessionRole; priority: number; lastSeen: number }>
  /** Set while we are waiting for a peer to release the connections */
  claiming: boolean
  vaultVersion: number
}

export interface CoordinatorTransport {
  /** Send a frame to one peer, or to all when no id is given */
  send: (frame: SessionFrame, peerId?: string) => void
  /** True when at least one peer is connected */
  hasPeers: () => boolean
}

export type SessionFrame =
  | {
      t: 'heartbeat'
      role: SessionRole
      priority: number
      since: string | null
      vaultVersion: number
      /** Optional: a peer on an older build does not send it */
      holding?: string[]
    }
  | { t: 'claim'; priority: number }
  | { t: 'yielded' }
  | { t: 'goodbye' }

type Listener = (state: SessionState) => void

export class SessionCoordinator {
  private role: SessionRole = 'primary'
  private since: string | null = null
  private claiming = false
  private readonly peers = new Map<
    string,
    { role: SessionRole; priority: number; lastSeen: number }
  >()

  /** What each peer last said it was holding, kept after the peer is gone */
  private readonly peerHolding = new Map<string, string[]>()

  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private readonly listeners = new Set<Listener>()

  /** Set while we are still looking around, so a late peer can extend the wait */
  private discoveryTimer: ReturnType<typeof setTimeout> | null = null
  private discoveryDeadline = 0

  constructor(
    private readonly priority: number,
    private readonly transport: CoordinatorTransport,
    private readonly connections: ConnectionControl
  ) {}

  start(): void {
    this.heartbeatTimer ??= setInterval(() => this.tick(), HEARTBEAT_INTERVAL_MS)

    if (this.transport.hasPeers()) {
      // Someone might already be holding the connections — listen first.
      this.role = 'follower'
      this.since = null
      this.discoveryDeadline = Date.now() + DISCOVERY_CAP_MS
      this.armDiscovery(DISCOVERY_MS)
    } else {
      this.becomePrimary()
    }

    this.emit()
  }

  stop(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
    this.heartbeatTimer = null
    this.endDiscovery()
  }

  onChange(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  state(): SessionState {
    return {
      role: this.role,
      priority: this.priority,
      since: this.since,
      peers: Object.fromEntries(this.peers),
      claiming: this.claiming,
      vaultVersion: this.connections.vaultVersion()
    }
  }

  /** A peer disconnected from the link entirely */
  peerGone(peerId: string): void {
    if (this.peers.delete(peerId)) this.evaluate()
  }

  handleFrame(peerId: string, frame: SessionFrame): void {
    // A frame arriving before start() (or after stop()) must not flip roles:
    // this device is not in a position to hold or hand over anything yet.
    if (!this.heartbeatTimer) return

    switch (frame.t) {
      case 'heartbeat': {
        this.peers.set(peerId, {
          role: frame.role,
          priority: frame.priority,
          lastSeen: Date.now()
        })
        // Remembered past the peer going away, which is when it is needed:
        // the whole point is to dial what it had once it is gone.
        if (frame.holding && frame.role === 'primary') {
          this.peerHolding.set(peerId, frame.holding)
        }
        this.evaluate()
        break
      }

      case 'claim': {
        // Someone with a better claim wants the connections. Release them
        // before saying so, or both devices are briefly on the network.
        if (frame.priority > this.priority && this.role === 'primary') {
          this.becomeFollower()
          this.transport.send({ t: 'yielded' }, peerId)
        } else {
          // We outrank them: keep the connections and re-assert.
          this.sendHeartbeat(peerId)
        }
        break
      }

      case 'yielded': {
        if (this.claiming) {
          this.claiming = false
          this.becomePrimary()
        }
        break
      }

      case 'goodbye': {
        // They said so rather than us having to wait and infer it
        this.peers.delete(peerId)
        this.evaluate()
        break
      }
    }
  }

  /**
   * Tell the peers we are going, and stop.
   *
   * The difference between this and [stop] is sixteen seconds of the other
   * device not knowing, which is sixteen seconds of a user's messages going
   * nowhere every time they close the app on purpose.
   */
  leave(): void {
    // Stop before speaking. Saying goodbye while still listening means the
    // peer takes over, beats, and this device — already on its way out —
    // answers by claiming the connection straight back off them.
    const wasRunning = this.heartbeatTimer !== null
    this.stop()
    if (wasRunning) this.transport.send({ t: 'goodbye' })
  }

  /** Called by the transport each time a peer connects */
  peerConnected(peerId: string): void {
    this.peers.set(peerId, { role: 'follower', priority: 0, lastSeen: Date.now() })
    this.sendHeartbeat(peerId)

    // Someone turned up while we were looking: give their heartbeat time to
    // arrive before deciding whether anyone is holding the connections.
    if (this.discoveryTimer) this.armDiscovery(PEER_GRACE_MS)
  }

  // ── internals ──────────────────────────────────────────────────────

  /** (Re)start the discovery countdown, never past the cap */
  private armDiscovery(delayMs: number): void {
    if (this.discoveryTimer) clearTimeout(this.discoveryTimer)
    const remaining = Math.max(0, this.discoveryDeadline - Date.now())
    this.discoveryTimer = setTimeout(() => {
      this.discoveryTimer = null
      this.evaluate()
    }, Math.min(delayMs, remaining))
  }

  private endDiscovery(): void {
    if (this.discoveryTimer) clearTimeout(this.discoveryTimer)
    this.discoveryTimer = null
  }

  private tick(): void {
    this.expirePeers()

    // Everyone beats, follower included. A silent follower is invisible to the
    // primary, which then cannot show the user that the other device is there
    // — and cannot tell "no peer" apart from "a peer that is following me".
    this.sendHeartbeat()

    // No primary in sight for long enough: take over. Not while discovery is
    // still open, though — that is the window's whole purpose.
    if (this.role !== 'primary' && !this.discoveryTimer && !this.livePrimary()) this.takeOver()
  }

  private expirePeers(): void {
    const cutoff = Date.now() - HEARTBEAT_TIMEOUT_MS
    let changed = false
    for (const [id, peer] of this.peers) {
      if (peer.lastSeen < cutoff) {
        this.peers.delete(id)
        changed = true
      }
    }
    if (changed) this.emit()
  }

  private livePrimary(): { priority: number } | null {
    const cutoff = Date.now() - HEARTBEAT_TIMEOUT_MS
    for (const peer of this.peers.values()) {
      if (peer.role === 'primary' && peer.lastSeen >= cutoff) return peer
    }
    return null
  }

  /**
   * Work out whether this device should be holding the connections.
   *
   * Ties never happen in practice (desktop 100, phone 10) but are broken
   * deterministically anyway, so two devices cannot both decide they win.
   */
  private evaluate(): void {
    const primary = this.livePrimary()

    if (this.role === 'primary' && primary && primary.priority > this.priority) {
      // A better host is already up; step aside without being asked.
      this.becomeFollower()
      return
    }

    if (this.role === 'primary' && primary && primary.priority < this.priority) {
      // Two primaries, and we outrank. Tell them to let go rather than both
      // sitting on the network.
      this.transport.send({ t: 'claim', priority: this.priority })
      return
    }

    if (this.role === 'follower' && primary && primary.priority < this.priority) {
      // We outrank the current primary — ask it to hand over.
      this.claim()
      return
    }

    if (this.role === 'follower' && !primary && !this.claiming) {
      this.takeOver()
    }
  }

  private claim(): void {
    if (this.claiming) return
    this.claiming = true
    this.transport.send({ t: 'claim', priority: this.priority })
    this.emit()

    // If nobody yields, take over anyway rather than leaving the user with
    // no connection at all.
    setTimeout(() => {
      if (this.claiming) {
        this.claiming = false
        this.takeOver()
      }
    }, HEARTBEAT_TIMEOUT_MS)
  }

  private takeOver(): void {
    if (this.role === 'primary') return
    this.becomePrimary()
  }

  /**
   * Everything any peer was last seen holding.
   *
   * What to dial on taking over, when this device has no memory of its own —
   * which is every time it has restarted since the handover.
   */
  heldByPeers(): string[] {
    const all = new Set<string>()
    for (const held of this.peerHolding.values()) {
      for (const serverId of held) all.add(serverId)
    }
    return [...all]
  }

  private becomePrimary(): void {
    this.endDiscovery()
    this.role = 'primary'
    this.since = new Date().toISOString()
    this.claiming = false
    this.connections.resume()
    this.sendHeartbeat()
    this.emit()
  }

  private becomeFollower(): void {
    this.role = 'follower'
    this.since = null
    this.connections.release()
    this.emit()
  }

  private sendHeartbeat(peerId?: string): void {
    this.transport.send(
      {
        t: 'heartbeat',
        role: this.role,
        priority: this.priority,
        since: this.since,
        vaultVersion: this.connections.vaultVersion(),
        holding: this.connections.holding()
      },
      peerId
    )
  }

  private emit(): void {
    const state = this.state()
    for (const listener of this.listeners) {
      try {
        listener(state)
      } catch (err) {
        console.error('Session listener failed:', err)
      }
    }
  }
}
