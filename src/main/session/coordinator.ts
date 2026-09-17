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

/**
 * A Switchboard with no window, on something that never sleeps.
 *
 * It outranks both, and the gap is deliberately wide rather than 101: this is
 * a different kind of thing, not a slightly better desktop. Somebody who runs
 * one has said what they want by running it — the connections live there, and
 * a laptop opening or closing does not move them.
 *
 * That is also what makes the nick survive. With a desktop and a phone the
 * connection changes hands every time the better device comes and goes, and
 * each hand-over is a moment on the network where you are briefly gone. A
 * headless instance simply never leaves, so there is nothing to hand over and
 * the nick is held continuously — which is the whole point of a bouncer.
 */
export const SERVER_PRIORITY = 1_000

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

/**
 * How long a peer whose transport dropped has to come back.
 *
 * A phone's link goes away every time Android freezes the process and comes
 * back a second later; the reconnect ladder's first two rungs are one second
 * and two. This covers those without covering a device that has actually gone
 * — see [SessionCoordinator.peerGone].
 */
export const TRANSPORT_GRACE_MS = 6_000

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
  /**
   * A peer has stopped beating and is being forgotten.
   *
   * Worth telling the transport, because the coordinator knows first. Three
   * missed beats is sixteen seconds; a QUIC connection to a machine that has
   * restarted takes its idle timeout to fail, which is longer. A transport
   * that can redial wants to start now rather than then — otherwise a desktop
   * that restarts finishes looking around, concludes it is alone, and joins
   * the network beside the instance that is about to come back.
   */
  peerExpired?: (peerId: string) => void
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
      /**
       * The rank of the primary this device is following, if any.
       *
       * Three devices do not always all see each other. The phone is paired to
       * the desktop, the desktop to the always-on instance, and nothing pairs
       * the phone to the always-on instance — so the phone sees one peer, a
       * follower, concludes that nobody is holding the network, and takes over
       * beside an instance that has been holding it all along.
       *
       * Saying "I am following somebody at this rank" is enough to stop that
       * without inventing a routing layer. Optional, because a peer on an
       * older build does not send it; absent means only what it used to mean.
       */
      following?: number
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
    { role: SessionRole; priority: number; lastSeen: number; following?: number }
  >()

  /** What each peer last said it was holding, kept after the peer is gone */
  private readonly peerHolding = new Map<string, string[]>()

  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private readonly listeners = new Set<Listener>()

  /** Set while we are still looking around, so a late peer can extend the wait */
  private discoveryTimer: ReturnType<typeof setTimeout> | null = null
  private discoveryDeadline = 0
  /**
   * The primary we last handed the connections to.
   *
   * A device can be a follower and still be holding: it was on the network
   * before the other one arrived, or it started as a follower because a peer
   * was paired. Nothing used to notice, so both devices sat on the same
   * network under two nicks — the exact thing the discovery window exists to
   * prevent, arrived at from the other direction. Remembering which host we
   * deferred to makes the hand-over happen once when that host appears,
   * rather than on every heartbeat it sends.
   */
  private deferredTo: string | null = null

  /**
   * Rank is asked for rather than captured.
   *
   * It comes from the host — what kind of machine this is — and the host is
   * installed by the entry point, which on some builds happens after this
   * module has been loaded. A number read at construction time is a number
   * read too early.
   */
  private readonly rank: () => number

  constructor(
    priority: number | (() => number),
    private readonly transport: CoordinatorTransport,
    private readonly connections: ConnectionControl
  ) {
    this.rank = typeof priority === 'function' ? priority : () => priority
  }

  private get priority(): number {
    return this.rank()
  }

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

  /**
   * The transport to a peer dropped.
   *
   * Which is not the same thing as the peer being gone, and treating it as
   * though it were is what made two devices both say they were holding the
   * connections.
   *
   * A phone's link drops constantly and by design: Android freezes a
   * backgrounded process, and the QUIC connection goes with it. It redials a
   * second later — the desktop's log shows that cycle twenty times in
   * twenty-six minutes, each one a `ConnectionLost` followed immediately by
   * the same device connecting again. This used to delete the peer and hold an
   * election on the spot, so every one of those blips made the phone decide
   * the desktop had gone and take the connections, and the desktop's next
   * heartbeat handed them back. The pair spent the evening trading the network
   * back and forth, a few seconds at a time.
   *
   * The heartbeat timeout already answers "is the other device still there",
   * and answers it with three missed beats rather than one dropped socket. So
   * a dropped transport does not decide anything: it brings the peer's
   * deadline forward to [TRANSPORT_GRACE_MS] from now and lets the ordinary
   * expiry run. Come back inside that, and nothing happened.
   *
   * The cost is that a desktop which really has gone is noticed a few seconds
   * later than it used to be. That is the same few seconds the design already
   * spends on a peer that stops talking without closing anything — a lid
   * closing, a cable pulled — which is the more common way of the two.
   */
  peerGone(peerId: string): void {
    const peer = this.peers.get(peerId)
    if (!peer) return

    const deadline = Date.now() - HEARTBEAT_TIMEOUT_MS + TRANSPORT_GRACE_MS
    // Only ever earlier. A peer that has been quiet for longer than the grace
    // must not have its clock wound forward by losing a socket as well.
    if (peer.lastSeen > deadline) peer.lastSeen = deadline
    this.emit()
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
          lastSeen: Date.now(),
          following: frame.following
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
    this.discoveryTimer = setTimeout(
      () => {
        this.discoveryTimer = null
        this.evaluate()
      },
      Math.min(delayMs, remaining)
    )
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

    /*
     * No primary for long enough: take over.
     *
     * "No primary" has to mean none anywhere, not none we can see. With three
     * devices the phone is paired to the desktop and the desktop to the
     * always-on instance, and nothing pairs the phone to the always-on
     * instance — so the phone saw one peer, a follower, and would have taken
     * over beside something that had been holding the network all along.
     *
     * Not while discovery is still open, though — that is the window's whole
     * purpose.
     */
    if (this.role !== 'primary' && !this.discoveryTimer && this.heldElsewhere() === null) {
      this.takeOver()
    }
  }

  private expirePeers(): void {
    const cutoff = Date.now() - HEARTBEAT_TIMEOUT_MS
    const expired: string[] = []
    for (const [id, peer] of this.peers) {
      if (peer.lastSeen < cutoff) {
        this.peers.delete(id)
        expired.push(id)
      }
    }
    if (expired.length === 0) return

    for (const id of expired) this.transport.peerExpired?.(id)
    this.emit()
  }

  private livePrimary(): { id: string; priority: number } | null {
    const cutoff = Date.now() - HEARTBEAT_TIMEOUT_MS
    for (const [id, peer] of this.peers) {
      if (peer.role === 'primary' && peer.lastSeen >= cutoff) return { id, priority: peer.priority }
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

    if (this.role === 'follower' && primary && primary.priority > this.priority) {
      // Following a better host. If this device is still on the network —
      // which it is when it was already there as that host arrived — hand
      // over now. Once per host, not once per heartbeat: see `deferredTo`.
      if (this.deferredTo !== primary.id) {
        this.deferredTo = primary.id
        if (this.connections.holding().length > 0) this.connections.release()
      }
      return
    }

    /*
     * Nobody is holding — but "nobody" has to mean nobody anywhere.
     *
     * `livePrimary` only sees peers this device is paired with. Three devices
     * are not always all paired: the phone to the desktop, the desktop to the
     * always-on instance, and nothing between the phone and the always-on
     * instance. The phone then sees one peer, a follower, and would take over
     * beside something that has been holding the network the whole time.
     */
    if (this.role === 'follower' && !primary && !this.claiming) {
      if (this.heldElsewhere() === null) this.takeOver()
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
    this.deferredTo = null
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
    this.deferredTo = this.livePrimary()?.id ?? null
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
        holding: this.connections.holding(),
        /*
         * Pass on that somebody is holding, for a peer who cannot see them.
         *
         * Only what this device can see itself, never what it was told. A
         * relayed report comes straight back: the phone hears "somebody at
         * 1000 is holding" from the desktop, repeats it, and the desktop then
         * refuses to take over when that instance dies because the phone is
         * still saying it is there. One hop covers the topology that actually
         * occurs — phone, desktop, always-on — and cannot loop.
         */
        ...(this.role === 'follower'
          ? { following: this.livePrimary()?.priority ?? undefined }
          : {})
      },
      peerId
    )
  }

  /**
   * The rank of the primary that is holding the network, seen or heard about.
   *
   * Directly if we can see it. Otherwise from a peer that says it can — which
   * is the only thing a device at the far end of a chain has to go on, and is
   * what stops a phone paired only to the desktop taking over beside an
   * always-on instance it has never met.
   *
   * Used to decide whether to take over, never to decide what to say. Saying
   * it on would send it back where it came from.
   */
  private heldElsewhere(): number | null {
    const direct = this.livePrimary()
    if (direct) return direct.priority

    const cutoff = Date.now() - HEARTBEAT_TIMEOUT_MS
    let best: number | null = null
    for (const peer of this.peers.values()) {
      if (peer.lastSeen < cutoff || peer.following === undefined) continue
      if (best === null || peer.following > best) best = peer.following
    }
    return best
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
