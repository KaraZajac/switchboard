import { host } from '../host'
import { readFile, writeFile, mkdir } from 'fs/promises'
import { randomBytes } from 'crypto'
import { join } from 'path'
import { ircManager } from '../irc/manager'
import { invokeForRemote, isRemoteAllowed } from '../ipc/registry'
import {
  getPairedDevices,
  isDevicePaired,
  pairDevice,
  revokeDevice,
  touchDevice,
  type PairedDevice
} from '../storage/models/device'
import { getSetting, setSetting } from '../storage/models/settings'
import {
  encodeFrame,
  generatePairingCode,
  pairingAttempt,
  isPeerFrame,
  FrameDecoder,
  PROTOCOL_VERSION,
  REMOTE_ALPN,
  type ClientFrame,
  type PeerFrame,
  type ServerFrame
} from './protocol'
import { SessionCoordinator, type SessionFrame, type SessionState } from '../session/coordinator'
import { exportVault, importVault, onVaultChanged, vaultStatus } from '../vault/vault'
import { setDeviceNotifier, sessionChanged } from '../ipc/notify'
import { shouldAdoptVault } from '@shared/vaultorder'
import type { VaultEnvelope } from '../vault/crypto'

/**
 * One instance's half of the remote link.
 *
 * Holds an iroh endpoint that both accepts and dials, and gives every peer the
 * same core the desktop window talks to: calls go through the IPC registry,
 * and every event the renderer receives is mirrored across.
 *
 * Accepting alone was enough while there were two kinds of thing and only one
 * of them moved — a phone dials a desktop, and a desktop is never the one
 * looking for somebody. A headless instance breaks that: it is another
 * accepting peer, so a desktop and a headless could both be running, both
 * listening, and never see each other. Whichever of two peers has the other's
 * ticket dials; after that the connection is symmetric and neither end is more
 * of a server than the other.
 *
 * Identity is the endpoint's ed25519 key, authenticated by QUIC. Pairing binds
 * that key to a deliberate human act — a code shown on the other machine — and
 * after that the peer is recognised by key alone.
 */

// iroh's native module is loaded lazily so a machine where the binary is
// missing still runs Switchboard, just without the remote link.
type IrohModule = typeof import('@number0/iroh')
type IrohEndpoint = import('@number0/iroh').Endpoint
type IrohConnection = import('@number0/iroh').Connection

const ALPN_BYTES = Array.from(Buffer.from(REMOTE_ALPN))
const PAIRING_WINDOW_MS = 5 * 60 * 1000

interface PairingSession {
  code: string
  expiresAt: number
  /** Wrong guesses so far, across every device that has tried */
  wrong: number
}

interface RemotePeer {
  endpointId: string
  name: string
  send: (frame: ServerFrame) => void
  close: () => void
}

export interface RemoteStatus {
  available: boolean
  running: boolean
  endpointId: string | null
  ticket: string | null
  pairing: { code: string; expiresAt: number } | null
  devices: PairedDevice[]
  connected: string[]
  /**
   * Instances this one dials, as opposed to waits for.
   *
   * Separate from `devices` because they answer different questions: that one
   * is who may connect to us, this one is who we go looking for. A headless
   * Switchboard is normally in both.
   */
  dialled: { ticket: string; name?: string; connected: boolean }[]
  error: string | null
}

let iroh: IrohModule | null = null
let endpoint: IrohEndpoint | null = null
let acceptLoop: Promise<void> | null = null
let stopping = false
let pairing: PairingSession | null = null
let lastError: string | null = null
/**
 * Everyone on the link right now, dialled or accepted.
 *
 * One map for both, because after the handshake there is no difference: either
 * side may be holding the connections, either may have the newer vault, and
 * the coordinator reaches all of them the same way.
 */
const peers = new Map<string, RemotePeer>()
let unsubscribeEvents: (() => void) | null = null

/**
 * Which device is on the network.
 *
 * Rank comes from the machine rather than from this file, because the same
 * engine runs on all three: a headless instance outranks a desktop, which
 * outranks a phone. In normal use the best one present stays primary and the
 * rest follow; when it goes the next one takes over, and it takes the
 * connections back on return.
 */
export const session = new SessionCoordinator(
  () => host().sessionPriority(),
  {
    send: (frame: SessionFrame, peerId?: string) => {
      if (peerId) {
        peers.get(peerId)?.send(frame)
        return
      }
      for (const client of peers.values()) client.send(frame)
    },
    /**
     * "Could another device be holding the connections?"
     *
     * A device that is merely paired counts, not just one that is dialled in.
     * On a restart the phone's link has died with us and takes a few seconds to
     * come back — assuming primacy in that gap puts this desktop on the network
     * beside a phone that is already there, and the user turns up twice under
     * `nick` and `nick_`. Waiting out the discovery window costs six seconds and
     * removes the race entirely.
     */
    hasPeers: () => peers.size > 0 || getPairedDevices().length > 0 || dialledPeers().length > 0,

    /**
     * Drop a connection the coordinator has given up on.
     *
     * The heartbeat notices a peer has gone three beats before QUIC does, and
     * for a dialled peer that difference is the whole thing: closing here ends
     * the read loop, which is what the retry is waiting on. Without it a
     * desktop that restarts is not redialled until the old connection times
     * out — by which time it has finished looking around, concluded it is
     * alone, and joined the network beside the instance about to come back.
     */
    peerExpired: (peerId) => {
      const peer = peers.get(peerId)
      if (!peer) return
      peers.delete(peerId)
      peer.close()
    }
  },
  {
    // Whatever the phone was holding as well as whatever this desktop
    // released, because a desktop that has restarted remembers neither.
    resume: () => ircManager.resumeConnections(session.heldByPeers()),
    release: () => ircManager.releaseConnections(),
    vaultVersion: () => vaultStatus().version,
    holding: () => ircManager.connectedServerIds()
  }
)

export function sessionState(): SessionState {
  return session.state()
}

/**
 * Set while the link is coming up and nobody has decided who holds yet.
 *
 * The coordinator starts life as `primary` because that is the right answer
 * for a Switchboard with no link at all. Binding an endpoint takes a few
 * seconds, and in that gap the window reports itself ready and auto-connect
 * runs — reading a role that had not been decided, and dialling everything
 * beside an always-on instance that was already there.
 */
let deciding = false

/*
 * Installed here rather than when the link starts, because the race is
 * precisely that the link has not started yet.
 */
ircManager.useSessionRole(() => !deciding && session.state().role === 'primary')

/** Stable identity across restarts, so paired devices keep working */
async function loadSecretKey(): Promise<number[]> {
  const dir = join(host().dataDir(), 'remote')
  const file = join(dir, 'endpoint.key')
  try {
    const existing = await readFile(file)
    if (existing.length === 32) return Array.from(existing)
  } catch {
    // first run
  }
  const key = randomBytes(32)
  await mkdir(dir, { recursive: true })
  await writeFile(file, key, { mode: 0o600 })
  return Array.from(key)
}

/**
 * Events that stay on this machine, whatever else is relayed.
 *
 * `irc:raw` is the wire log: every line in and out, verbatim. Nothing
 * consumes it — not the renderer, not the phone — and it was going to every
 * paired device carrying `PASS`, and `AUTHENTICATE`, which for SASL PLAIN is
 * base64 of `user\0user\0password` and decodes in one step.
 *
 * So the rule `sanitizeForRemote` exists to keep — that credentials never
 * leave this desktop for a paired device — was being kept in the config and
 * broken on the wire beside it. Relaying a debug stream is not something to
 * do by default; it is something to do on purpose, and there is no purpose
 * here.
 */
const NEVER_RELAYED = new Set(['irc:raw'])

/**
 * The setting that says this desktop is one a phone may reach.
 *
 * Pairing is a durable relationship — the endpoint's secret key is kept on
 * disk precisely so the ticket a phone saved stays dialable across restarts —
 * but the listener in front of it was not. Quit the desktop and reopen it and
 * the phone could no longer reach it at all, silently, until somebody went
 * back into Settings and flipped the toggle again.
 */
const LINK_ENABLED = 'remoteLinkEnabled'

/**
 * Start the link again if it was running when the desktop last closed.
 *
 * An unset setting means a build from before this was remembered. Having
 * paired a device is what somebody meant by turning it on, so that is what it
 * falls back to; an explicit `false` is honoured, because a user who switched
 * it off did so with the phone still paired.
 */
export async function resumeRemoteLink(): Promise<void> {
  const chosen = getSetting<boolean>(LINK_ENABLED)
  const wanted = chosen === null ? getPairedDevices().length > 0 : chosen === true
  if (!wanted) return

  // Hold auto-connect until the coordinator has looked around
  deciding = true

  try {
    const status = await startRemoteLink()
    if (status.error) console.warn(`Remote link did not resume: ${status.error}`)
  } finally {
    deciding = false
  }
}

export async function startRemoteLink(): Promise<RemoteStatus> {
  setSetting(LINK_ENABLED, true)
  if (endpoint) return remoteStatus()

  stopping = false
  lastError = null

  try {
    iroh = iroh ?? (await import('@number0/iroh'))
  } catch (err) {
    lastError = 'The iroh native module could not be loaded on this platform'
    console.error('Remote link unavailable:', err)
    return remoteStatus()
  }

  try {
    endpoint = await iroh.Endpoint.bind({
      alpns: [ALPN_BYTES],
      secretKey: await loadSecretKey()
    })
    // Relays give the phone a way in when a direct punch fails; waiting for one
    // keeps the first ticket we hand out actually dialable.
    await endpoint.online()
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err)
    endpoint = null
    console.error('Failed to start the remote link:', err)
    return remoteStatus()
  }

  unsubscribeEvents = ircManager.subscribe((channel, data) => {
    if (NEVER_RELAYED.has(channel)) return
    broadcast({ t: 'event', channel, data })
  })

  // What the window is told that did not come from a connection — a read
  // marker set here on a server with no `draft/read-marker` to echo it
  setDeviceNotifier((channel, data) => broadcast({ t: 'event', channel, data }))

  // A config change on this device is offered to the others straight away
  onVaultChanged((version) => {
    const updatedAt = exportVault()?.updatedAt
    for (const client of peers.values()) {
      client.send({ t: 'vault-offer', version, updatedAt })
    }
  })

  // The window shows which device is holding the connections; tell it when
  // that changes rather than making it ask on a timer
  session.onChange(() => sessionChanged())

  acceptLoop = runAcceptLoop()
  session.start()
  deciding = false
  console.info(`Remote link listening as ${endpoint.id().toString()}`)

  // Go and find whatever this instance was told to look for. Not awaited: a
  // peer that is switched off would otherwise hold up everything behind it,
  // and the retry loop is what handles that anyway.
  void redialAll()
  return remoteStatus()
}

export async function stopRemoteLink(): Promise<RemoteStatus> {
  setDeviceNotifier(null)
  setSetting(LINK_ENABLED, false)
  stopping = true
  pairing = null

  // Say so before closing, so a phone takes over now rather than waiting out
  // the heartbeat timeout wondering.
  session.leave()

  for (const attempt of dialling.values()) attempt.stop()
  dialling.clear()

  for (const client of peers.values()) client.close()
  peers.clear()

  unsubscribeEvents?.()
  unsubscribeEvents = null

  // Nothing is arbitrating any more, so this instance is the one holding
  deciding = false

  const current = endpoint
  endpoint = null
  if (current) await current.close().catch(() => {})
  await acceptLoop?.catch(() => {})
  acceptLoop = null

  return remoteStatus()
}

// ── Dialling out ───────────────────────────────────────────────────

/**
 * Tickets this instance dials, kept so it redials on every launch.
 *
 * A setting rather than the device table, because these are a different fact:
 * the table records who may connect *to* us, and this records who we go
 * looking for. A peer ends up in both once it has answered.
 */
const DIALLED = 'remoteDialled'

interface DialledPeer {
  ticket: string
  /** What it called itself when it answered, for the settings list */
  name?: string
  /**
   * Its endpoint key, learned on the first successful dial.
   *
   * Kept so "are we connected to this one" can be answered by identity rather
   * than by matching names, which two instances are perfectly entitled to
   * share.
   */
  endpointId?: string
}

/** Attempts in flight or waiting to retry, by ticket */
const dialling = new Map<string, { stop: () => void }>()

export function dialledPeers(): DialledPeer[] {
  return getSetting<DialledPeer[]>(DIALLED) ?? []
}

function rememberDialled(ticket: string, name?: string, endpointId?: string): void {
  const kept = dialledPeers().filter((peer) => peer.ticket !== ticket)
  setSetting(DIALLED, [...kept, { ticket, name, endpointId }])
}

/**
 * Stop dialling a peer, and drop the connection if it is up.
 *
 * Deliberately does not revoke it: forgetting a ticket says "stop looking for
 * this one", and revoking says "never let it in again". Somebody who moves
 * their headless instance to another machine means the first.
 */
export function forgetDialledPeer(ticket: string): RemoteStatus {
  setSetting(
    DIALLED,
    dialledPeers().filter((peer) => peer.ticket !== ticket)
  )
  dialling.get(ticket)?.stop()
  dialling.delete(ticket)
  return remoteStatus()
}

/**
 * Go and find another Switchboard.
 *
 * The pairing code is needed the first time only; after that the far end
 * recognises this endpoint's key. Which is also why the ticket is worth
 * keeping — a redial on the next launch needs no human at either end.
 */
export async function dialPeer(
  ticket: string,
  pairingCode?: string
): Promise<{ ok: boolean; error?: string }> {
  const trimmed = ticket.trim()
  if (!trimmed) return { ok: false, error: 'No ticket' }

  if (!endpoint) {
    const started = await startRemoteLink()
    if (started.error) return { ok: false, error: started.error }
  }
  if (!endpoint || !iroh) return { ok: false, error: 'The remote link is not running' }

  let addr: ReturnType<IrohModule['EndpointTicket']['fromString']>
  try {
    addr = iroh.EndpointTicket.fromString(trimmed)
  } catch {
    return { ok: false, error: 'That does not look like a Switchboard ticket' }
  }

  // Dialling ourselves would pair this instance with itself, which the
  // coordinator would then arbitrate against — one device, two peers, both
  // convinced the other might be holding the connections.
  if (addr.endpointAddr().id.toString() === endpoint.id().toString()) {
    return { ok: false, error: "That is this instance's own ticket" }
  }

  dialling.get(trimmed)?.stop()

  const attempt = await openDialled(trimmed, addr.endpointAddr(), pairingCode)
  if (attempt.ok) rememberDialled(trimmed, attempt.name, attempt.endpointId)
  return attempt
}

/** Redial everything this instance was told to look for */
async function redialAll(): Promise<void> {
  for (const peer of dialledPeers()) {
    const result = await dialPeer(peer.ticket)
    if (!result.ok)
      console.warn(`Could not reach ${peer.name ?? 'a paired instance'}: ${result.error}`)
  }
}

/**
 * One dialled connection, and the loop that puts it back.
 *
 * A link that does not come back on its own is a link somebody has to notice
 * and repair by hand, which for an always-on instance means noticing it hours
 * later. The delay grows so a machine that is simply off is not hammered, and
 * a pairing code is deliberately not reused on a retry — it is good once, and
 * a retry that keeps sending a spent one just collects refusals.
 */
async function openDialled(
  ticket: string,
  addr: import('@number0/iroh').EndpointAddr,
  pairingCode?: string
): Promise<{ ok: boolean; error?: string; name?: string; endpointId?: string }> {
  if (!endpoint) return { ok: false, error: 'The remote link is not running' }

  let closed = false
  let retry: ReturnType<typeof setTimeout> | null = null
  let attempts = 0

  const handle = {
    stop: () => {
      closed = true
      if (retry) clearTimeout(retry)
      retry = null
    }
  }
  dialling.set(ticket, handle)

  const again = (): void => {
    if (closed || stopping) return
    attempts++
    /*
     * Quick at first, then backing off to a minute.
     *
     * The first retry after a connection that was working is the one that
     * matters: the peer is known good and has probably just restarted, and the
     * other end gives up looking for it after twenty seconds. Later attempts
     * are against a machine that is plainly off, and hammering that is rude
     * and pointless.
     */
    const delay = Math.min(60_000, 1_000 * 2 ** Math.min(attempts, 6))
    retry = setTimeout(() => void connect(), delay)
  }

  const connect = async (): Promise<{
    ok: boolean
    error?: string
    name?: string
    endpointId?: string
  }> => {
    if (closed || stopping || !endpoint) return { ok: false, error: 'Stopped' }

    try {
      const connection = await endpoint.connect(addr, ALPN_BYTES)
      attempts = 0
      const { settled, ended } = speakTo(connection, pairingCode)
      const outcome = await settled
      // The code is good once. A reconnection is recognised by key.
      pairingCode = undefined

      if (!outcome.ok) {
        // A refusal is not a network problem, and retrying it in a loop turns
        // one wrong code into a stream of them
        handle.stop()
        dialling.delete(ticket)
        return outcome
      }

      /*
       * Wait for it to end before lining up the next one.
       *
       * The handshake settles the moment the welcome lands, which is not the
       * moment the connection ends. Scheduling the retry there redialled a
       * link that was working — and each new dial closed the previous one,
       * so the two instances spent their time hanging up on each other
       * instead of talking.
       */
      void ended.then(again)
      return outcome
    } catch (err) {
      again()
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  return connect()
}

/**
 * The dialling side of the handshake, and the read loop after it.
 *
 * The mirror of `handleConnection`: that one accepts a stream and authorises a
 * hello, this one opens a stream and sends one. Everything after the welcome
 * is the same code, because after the welcome there is no difference.
 */
function speakTo(
  connection: IrohConnection,
  pairingCode?: string
): {
  /** Resolves when the far end has welcomed us, or refused */
  settled: Promise<{ ok: boolean; error?: string; name?: string; endpointId?: string }>
  /** Resolves when the connection is over, which is a different moment */
  ended: Promise<void>
} {
  const endpointId = connection.remoteId().toString()
  const decoder = new FrameDecoder()

  let closed = false
  let name = 'Switchboard'
  let welcomed = false
  let stream: Awaited<ReturnType<IrohConnection['openBi']>> | null = null

  let writes: Promise<void> = Promise.resolve()
  const send = (frame: ClientFrame | ServerFrame): void => {
    if (closed) return
    writes = writes
      .then(async () => {
        if (!stream) return
        await stream.send.writeAll(Array.from(encodeFrame(frame)))
      })
      .catch((err) => {
        if (closed) return
        closed = true
        peers.delete(endpointId)
        console.error(`Remote link to ${name} failed while writing:`, err)
      })
  }

  const close = (): void => {
    closed = true
    connection.close(0n, Array.from(Buffer.from('closed')))
  }

  // Not Promise.withResolvers: the node tsconfig targets an older lib, and a
  // handshake is not worth raising it for.
  let resolveSettled: (result: {
    ok: boolean
    error?: string
    name?: string
    endpointId?: string
  }) => void = () => {}
  let alreadySettled = false
  const settled = new Promise<{
    ok: boolean
    error?: string
    name?: string
    endpointId?: string
  }>((resolve) => {
    resolveSettled = (result) => {
      if (alreadySettled) return
      alreadySettled = true
      resolve(result)
    }
  })

  const ended = (async () => {
    try {
      stream = await connection.openBi()
      send({
        t: 'hello',
        v: PROTOCOL_VERSION,
        name: peerName(),
        ...(pairingCode ? { pairingCode } : {})
      })

      for (;;) {
        const chunk = await stream.recv.read(64 * 1024)
        if (!chunk || chunk.length === 0) break

        for (const raw of decoder.push(chunk)) {
          const frame = raw as ServerFrame

          if (!welcomed) {
            if (frame.t === 'denied') {
              console.warn(`Refused by ${endpointId.slice(0, 12)}…: ${frame.reason}`)
              resolveSettled({ ok: false, error: frame.reason })
              close()
              return
            }
            if (frame.t !== 'welcome') continue

            welcomed = true
            name = frame.name?.slice(0, 64) || 'Switchboard'

            // Recognised by key from here on, at both ends
            pairDevice(endpointId, name)

            peers.get(endpointId)?.close()
            peers.set(endpointId, { endpointId, name, send, close })
            console.info(`Linked to ${name} (${endpointId.slice(0, 12)}…)`)

            session.peerConnected(endpointId)
            const vault = exportVault()
            if (vault) {
              send({ t: 'vault-offer', version: vault.version, updatedAt: vault.updatedAt })
            }
            resolveSettled({ ok: true, name, endpointId })
            continue
          }

          if (isPeerFrame(frame)) {
            handlePeerFrame(endpointId, frame, send)
            touchDevice(endpointId)
            continue
          }

          /*
           * A call from the far end.
           *
           * The peer that dialled is not thereby the follower — a headless
           * instance might dial a desktop, or the other way round, and either
           * may end up primary. So this side answers calls as well as making
           * them.
           */
          const asCall = frame as unknown as ClientFrame
          if (asCall.t === 'call') {
            void handleCall(asCall, send)
            touchDevice(endpointId)
          }
        }
      }
    } catch (err) {
      if (!stopping) console.error('Remote link stream error:', err)
    } finally {
      closed = true
      if (peers.get(endpointId)?.send === send) peers.delete(endpointId)
      session.peerGone(endpointId)
      resolveSettled({ ok: welcomed, name, endpointId })
    }
  })()

  return { settled, ended }
}

/** What this instance calls itself to a peer */
function peerName(): string {
  return host().idleSeconds() === null ? 'Switchboard (always on)' : 'Switchboard desktop'
}

/** Open a pairing window and return the ticket a new device should scan. */
export async function startPairing(): Promise<RemoteStatus> {
  if (!endpoint) await startRemoteLink()
  if (!endpoint) return remoteStatus()

  pairing = { code: generatePairingCode(), expiresAt: Date.now() + PAIRING_WINDOW_MS, wrong: 0 }
  return remoteStatus()
}

export function cancelPairing(): RemoteStatus {
  pairing = null
  return remoteStatus()
}

export function revokeRemoteDevice(endpointId: string): RemoteStatus {
  revokeDevice(endpointId)
  // Revoking has to drop the live connection too, or the device keeps its
  // access until it happens to disconnect.
  peers.get(endpointId)?.close()
  peers.delete(endpointId)
  return remoteStatus()
}

export function remoteStatus(): RemoteStatus {
  const active = pairing && pairing.expiresAt > Date.now() ? pairing : null
  if (pairing && !active) pairing = null

  return {
    available: true,
    running: endpoint !== null,
    endpointId: endpoint ? endpoint.id().toString() : null,
    ticket: endpoint && iroh ? iroh.EndpointTicket.fromAddr(endpoint.addr()).toString() : null,
    pairing: active ? { code: active.code, expiresAt: active.expiresAt } : null,
    devices: getPairedDevices(),
    connected: [...peers.keys()],
    dialled: dialledPeers().map((peer) => ({
      ticket: peer.ticket,
      name: peer.name,
      // "Looking" and "found" look identical in a settings list otherwise, and
      // the difference is the whole question somebody has when they open it
      connected: !!peer.endpointId && peers.has(peer.endpointId)
    })),
    error: lastError
  }
}

function broadcast(frame: ServerFrame): void {
  for (const client of peers.values()) {
    try {
      client.send(frame)
    } catch (err) {
      console.error('Failed to push an event to a paired device:', err)
    }
  }
}

async function runAcceptLoop(): Promise<void> {
  while (endpoint && !stopping) {
    let incoming: Awaited<ReturnType<IrohEndpoint['acceptNext']>> = null
    try {
      incoming = await endpoint.acceptNext()
    } catch (err) {
      if (!stopping) console.error('Remote link accept failed:', err)
      break
    }
    if (!incoming) break

    void (async () => {
      try {
        const accepting = await incoming.accept()
        const connection = await accepting.connect()
        await handleConnection(connection)
      } catch (err) {
        if (!stopping) console.error('Remote connection ended badly:', err)
      }
    })()
  }
}

async function handleConnection(connection: IrohConnection): Promise<void> {
  const endpointId = connection.remoteId().toString()
  const stream = await connection.acceptBi()
  const decoder = new FrameDecoder()

  let authenticated = false
  let name = 'Unknown device'
  let closed = false

  // One QUIC stream, many event sources: writes must be serialised or two
  // concurrent writeAll calls interleave and the link dies — quietly, since
  // nothing is awaiting them.
  let writes: Promise<void> = Promise.resolve()

  const send = (frame: ServerFrame): void => {
    if (closed) return
    writes = writes
      .then(() => stream.send.writeAll(Array.from(encodeFrame(frame))))
      .catch((err) => {
        if (closed) return
        closed = true
        peers.delete(endpointId)
        console.error(`Remote link to ${name} failed while writing:`, err)
      })
  }

  const close = (): void => {
    closed = true
    connection.close(0n, Array.from(Buffer.from('closed')))
  }

  try {
    for (;;) {
      const chunk = await stream.recv.read(64 * 1024)
      if (!chunk || chunk.length === 0) break

      for (const raw of decoder.push(chunk)) {
        const frame = raw as ClientFrame

        if (!authenticated) {
          if (frame.t !== 'hello') {
            send({ t: 'denied', reason: 'Expected hello' })
            close()
            return
          }

          const decision = authorise(endpointId, frame)
          if (!decision.ok) {
            console.warn(`Remote device ${endpointId.slice(0, 12)}… rejected: ${decision.reason}`)
            send({ t: 'denied', reason: decision.reason })
            close()
            return
          }

          authenticated = true
          name = frame.name?.slice(0, 64) || 'Unknown device'
          pairDevice(endpointId, name)
          pairing = null // a code is good for one device

          peers.get(endpointId)?.close()
          peers.set(endpointId, { endpointId, name, send, close })

          // What kind of instance this is, not just that it is one. A
          // settings list showing two entries both called "Switchboard" is a
          // list nobody can act on.
          send({ t: 'welcome', v: PROTOCOL_VERSION, name: peerName(), paired: true })
          console.info(`Paired device connected: ${name} (${endpointId.slice(0, 12)}…)`)

          // Say who is holding the connections, and what config we have
          session.peerConnected(endpointId)
          const vault = exportVault()
          if (vault) {
            send({ t: 'vault-offer', version: vault.version, updatedAt: vault.updatedAt })
          }
          continue
        }

        if (isPeerFrame(frame)) {
          handlePeerFrame(endpointId, frame, send)
          touchDevice(endpointId)
          continue
        }

        if (frame.t === 'call') {
          void handleCall(frame, send)
          touchDevice(endpointId)
        }
      }
    }
  } catch (err) {
    if (!stopping) console.error('Remote link stream error:', err)
  } finally {
    closed = true
    /*
     * Only if this is still the connection for that device.
     *
     * A reconnecting peer arrives on a new stream and is accepted before the
     * old one finishes unwinding — the accept path closes the old connection
     * itself, which is what makes it unwind. So this block runs *after* the
     * replacement has been registered and `session.peerConnected` has been
     * called for it.
     *
     * The `peers` map already knew that. The coordinator did not: it was told
     * the device had gone every single time it came back, moments after being
     * told it was here. Guarded together, since they are one question.
     */
    if (peers.get(endpointId)?.send === send) {
      peers.delete(endpointId)
      session.peerGone(endpointId)
    }
  }
}

function authorise(
  endpointId: string,
  hello: Extract<ClientFrame, { t: 'hello' }>
): { ok: true } | { ok: false; reason: string } {
  if (hello.v !== PROTOCOL_VERSION) {
    return { ok: false, reason: `Unsupported protocol version ${hello.v}` }
  }

  if (isDevicePaired(endpointId)) return { ok: true }

  const session = pairing && pairing.expiresAt > Date.now() ? pairing : null
  if (!session) {
    return { ok: false, reason: 'This device is not paired. Start pairing on the desktop first.' }
  }

  switch (pairingAttempt(session, hello.pairingCode)) {
    case 'ok':
      return { ok: true }

    case 'exhausted':
      pairing = null
      return { ok: false, reason: 'Too many wrong codes. Start pairing again on the desktop.' }

    default:
      return { ok: false, reason: 'Wrong pairing code' }
  }
}

/**
 * Session and vault frames.
 *
 * These are peer-to-peer rather than request/response: either side may hold the
 * connections, and either side may have the newer config.
 */
function handlePeerFrame(
  peerId: string,
  frame: PeerFrame,
  send: (frame: ServerFrame) => void
): void {
  switch (frame.t) {
    case 'heartbeat':
      session.handleFrame(peerId, frame)

      // Every beat carries the sender's vault version, so a desktop that was
      // shut while the phone changed something notices it is behind without
      // being told twice. The phone has always done this; the desktop only
      // ever acted on an explicit offer, and a phone that made its change
      // while unlinked had no way to send one — so that change sat on the
      // phone until some edit here overtook it and wiped it out.
      if (frame.vaultVersion > vaultStatus().version) send({ t: 'vault-request' })
      return

    case 'claim':
    case 'yielded':
    case 'goodbye':
      session.handleFrame(peerId, frame)
      return

    case 'vault-offer': {
      // Ask whenever theirs might win, which is the adopter's rule and not a
      // stricter one. It used to be `>`, which meant two configs at the same
      // version never even spoke — so the tiebreak both devices implement for
      // exactly that case could never be reached over the wire.
      const current = exportVault()
      if (shouldAdoptVault({ version: frame.version, updatedAt: frame.updatedAt }, current)) {
        send({ t: 'vault-request' })
      }
      return
    }

    case 'vault-request': {
      const vault = exportVault()
      if (vault) send({ t: 'vault-payload', envelope: vault })
      return
    }

    case 'vault-payload': {
      const result = importVault(frame.envelope as VaultEnvelope)
      console.info(`Vault from ${peerId.slice(0, 12)}…: ${result.reason}`)
      return
    }
  }
}

async function handleCall(
  frame: Extract<ClientFrame, { t: 'call' }>,
  send: (frame: ServerFrame) => void
): Promise<void> {
  if (!isRemoteAllowed(frame.channel)) {
    send({
      t: 'result',
      id: frame.id,
      ok: false,
      error: `Not available remotely: ${frame.channel}`
    })
    return
  }

  try {
    const value = await invokeForRemote(frame.channel, frame.args ?? [])
    send({ t: 'result', id: frame.id, ok: true, value })
  } catch (err) {
    send({
      t: 'result',
      id: frame.id,
      ok: false,
      error: err instanceof Error ? err.message : String(err)
    })
  }
}
