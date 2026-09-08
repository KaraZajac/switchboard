import { app } from 'electron'
import { readFile, writeFile, mkdir } from 'fs/promises'
import { randomBytes, timingSafeEqual } from 'crypto'
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
import {
  encodeFrame,
  generatePairingCode,
  isPeerFrame,
  FrameDecoder,
  PROTOCOL_VERSION,
  REMOTE_ALPN,
  type ClientFrame,
  type PeerFrame,
  type ServerFrame
} from './protocol'
import {
  DESKTOP_PRIORITY,
  SessionCoordinator,
  type SessionFrame,
  type SessionState
} from '../session/coordinator'
import { exportVault, importVault, onVaultChanged, vaultStatus } from '../vault/vault'
import type { VaultEnvelope } from '../vault/crypto'

/**
 * The desktop half of the remote link.
 *
 * Holds an iroh endpoint, accepts connections from paired devices, and gives
 * each one the same core the desktop window talks to: calls go through the IPC
 * registry, and every event the renderer receives is mirrored to the device.
 *
 * Identity is the endpoint's ed25519 key, authenticated by QUIC. Pairing binds
 * that key to a deliberate human act — a code shown on the desktop — and after
 * that the device is recognised by key alone.
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
}

interface RemoteClient {
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
  error: string | null
}

let iroh: IrohModule | null = null
let endpoint: IrohEndpoint | null = null
let acceptLoop: Promise<void> | null = null
let stopping = false
let pairing: PairingSession | null = null
let lastError: string | null = null
const clients = new Map<string, RemoteClient>()
let unsubscribeEvents: (() => void) | null = null

/**
 * Which device is on the network.
 *
 * The desktop outranks a phone, so in normal use this stays primary and the
 * phone follows; when the desktop is gone the phone takes over and this hands
 * the connections back on return.
 */
export const session = new SessionCoordinator(
  DESKTOP_PRIORITY,
  {
    send: (frame: SessionFrame, peerId?: string) => {
      if (peerId) {
        clients.get(peerId)?.send(frame)
        return
      }
      for (const client of clients.values()) client.send(frame)
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
    hasPeers: () => clients.size > 0 || getPairedDevices().length > 0
  },
  {
    resume: () => ircManager.resumeConnections(),
    release: () => ircManager.releaseConnections(),
    vaultVersion: () => vaultStatus().version
  }
)

export function sessionState(): SessionState {
  return session.state()
}

/** Stable identity across restarts, so paired devices keep working */
async function loadSecretKey(): Promise<number[]> {
  const dir = join(app.getPath('userData'), 'remote')
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

export async function startRemoteLink(): Promise<RemoteStatus> {
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
    broadcast({ t: 'event', channel, data })
  })

  // A config change on this device is offered to the others straight away
  onVaultChanged((version) => {
    for (const client of clients.values()) client.send({ t: 'vault-offer', version })
  })

  acceptLoop = runAcceptLoop()
  session.start()
  console.info(`Remote link listening as ${endpoint.id().toString()}`)
  return remoteStatus()
}

export async function stopRemoteLink(): Promise<RemoteStatus> {
  stopping = true
  pairing = null

  // Say so before closing, so a phone takes over now rather than waiting out
  // the heartbeat timeout wondering.
  session.leave()

  for (const client of clients.values()) client.close()
  clients.clear()

  unsubscribeEvents?.()
  unsubscribeEvents = null

  const current = endpoint
  endpoint = null
  if (current) await current.close().catch(() => {})
  await acceptLoop?.catch(() => {})
  acceptLoop = null

  return remoteStatus()
}

/** Open a pairing window and return the ticket a new device should scan. */
export async function startPairing(): Promise<RemoteStatus> {
  if (!endpoint) await startRemoteLink()
  if (!endpoint) return remoteStatus()

  pairing = { code: generatePairingCode(), expiresAt: Date.now() + PAIRING_WINDOW_MS }
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
  clients.get(endpointId)?.close()
  clients.delete(endpointId)
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
    connected: [...clients.keys()],
    error: lastError
  }
}

function broadcast(frame: ServerFrame): void {
  for (const client of clients.values()) {
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
        clients.delete(endpointId)
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

          clients.get(endpointId)?.close()
          clients.set(endpointId, { endpointId, name, send, close })

          send({ t: 'welcome', v: PROTOCOL_VERSION, name: 'Switchboard', paired: true })
          console.info(`Paired device connected: ${name} (${endpointId.slice(0, 12)}…)`)

          // Say who is holding the connections, and what config we have
          session.peerConnected(endpointId)
          const vault = exportVault()
          if (vault) send({ t: 'vault-offer', version: vault.version })
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
    if (clients.get(endpointId)?.send === send) clients.delete(endpointId)
    session.peerGone(endpointId)
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

  const given = Buffer.from(hello.pairingCode ?? '')
  const expected = Buffer.from(session.code)
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return { ok: false, reason: 'Wrong pairing code' }
  }

  return { ok: true }
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
    case 'claim':
    case 'yielded':
    case 'goodbye':
      session.handleFrame(peerId, frame)
      return

    case 'vault-offer': {
      // Only ask for it if theirs is newer than ours
      if (frame.version > vaultStatus().version) send({ t: 'vault-request' })
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
    send({ t: 'result', id: frame.id, ok: false, error: `Not available remotely: ${frame.channel}` })
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
