import { createServer, type Server, type Socket } from 'net'
import { createServer as createTLSServer, type Server as TLSServer, type TlsOptions } from 'tls'
import { readFileSync } from 'fs'
import { BouncerSession, type RelayableMessage } from './session'
import { ircManager } from '../irc/manager'
import { getAllServers } from '../storage/models/server'
import { getMessages, conversationsWithin } from '../storage/models/message'
import { findNetwork } from '@shared/bouncerlogin'
import { createNetwork, changeNetwork, deleteNetwork } from './networks'
import type { IRCClient } from '../irc/client'

/**
 * Switchboard, being the bouncer.
 *
 * A headless instance already holds the connections. This is the part that
 * lets anything else reach them: a plain IRC port that irssi, WeeChat, Halloy
 * or another Switchboard can dial, arriving already joined to your channels
 * under your nick.
 *
 * Off unless somebody asks for it. It is a listening socket carrying an IRC
 * session with real credentials behind it, and a port that opens because the
 * software was installed is not a port anybody chose to open.
 */

export interface BouncerOptions {
  port: number
  /** What to bind. Loopback by default: a bouncer reached over SSH needs no more. */
  address?: string
  /** Null accepts any password, which is only ever right on a loopback bind */
  password: string | null
  /** Paths to a certificate and key, for a port somebody exposes */
  tls?: { cert: string; key: string } | null
  version: string
  serverName?: string
}

export interface BouncerStatus {
  running: boolean
  port: number | null
  address: string | null
  tls: boolean
  clients: { id: number; name: string; network: string | null }[]
  error: string | null
}

let server: Server | TLSServer | null = null
let listening: { port: number; address: string; tls: boolean } | null = null
let lastError: string | null = null
const sessions = new Set<BouncerSession>()

/** Every network this bouncer can offer, whether or not it is dialled in */
function networks(): { id: string; name: string; client: IRCClient | undefined }[] {
  return getAllServers().map((server) => ({
    id: server.id,
    name: server.name,
    client: ircManager.getClient(server.id)
  }))
}

/**
 * The last of a conversation, for a client that has just attached.
 *
 * Read from the same database the desktop and phone read, which is what makes
 * the backlog the same everywhere: a message you scrolled past on the phone is
 * the message irssi shows you when you attach.
 */
function backlog(serverId: string, target: string, limit: number): RelayableMessage[] {
  return storedMessages(serverId, target, { limit })
}

/** The same rows, for a `CHATHISTORY` window rather than an attach */
function storedMessages(
  serverId: string,
  target: string,
  window: { before?: string; after?: string; limit: number }
): RelayableMessage[] {
  try {
    return getMessages(serverId, target, window)
      .filter(
        (message) =>
          message.type === 'privmsg' || message.type === 'notice' || message.type === 'action'
      )
      .map((message) => ({
        time: message.timestamp,
        nick: message.nick ?? target,
        // An action was stored with its CTCP wrapper taken off. Put it back, or
        // the replay reads as somebody saying their own name.
        text: message.type === 'action' ? `\u0001ACTION ${message.content}\u0001` : message.content,
        kind: message.type === 'notice' ? ('notice' as const) : ('privmsg' as const),
        msgid: message.id
      }))
  } catch {
    // No history is a worse attach, not a failed one
    return []
  }
}

export async function startBouncer(options: BouncerOptions): Promise<BouncerStatus> {
  if (server) return bouncerStatus()

  const address = options.address ?? '127.0.0.1'
  lastError = null

  /*
   * A password is required off loopback, and there is no flag to skip it.
   *
   * On `127.0.0.1` the operating system already decides who may connect, and
   * somebody running this behind SSH has authenticated once already. On any
   * other address the port is reachable by whoever can route to it, and an
   * open one hands out a logged-in session on every network in the vault.
   */
  if (address !== '127.0.0.1' && address !== '::1' && !options.password) {
    lastError = 'A password is required to listen on anything but loopback'
    return bouncerStatus()
  }

  const accept = (socket: Socket): void => {
    const session = new BouncerSession(
      socket,
      {
        serverName: options.serverName ?? 'switchboard',
        password: options.password,
        version: options.version,
        backlog,
        history: {
          messages: storedMessages,
          targets: (serverId, after, before, limit) => {
            try {
              return conversationsWithin(serverId, after, before, limit)
            } catch {
              return []
            }
          }
        },
        networks: {
          all: networks,
          find: (wanted) =>
            findNetwork(
              networks(),
              wanted,
              (n) => n.name,
              (n) => n.id
            )
        },
        manage: {
          add: createNetwork,
          change: changeNetwork,
          remove: deleteNetwork
        },
        onEcho: (from, upstream, line) => {
          for (const other of sessions) {
            if (other === from && !other.wants.has('echo-message')) continue
            if (other.boundTo !== from.boundTo) continue
            other.write(line)
          }
          void upstream
        }
      },
      (closed) => sessions.delete(closed)
    )
    sessions.add(session)
  }

  try {
    if (options.tls) {
      const credentials: TlsOptions = {
        cert: readFileSync(options.tls.cert),
        key: readFileSync(options.tls.key)
      }
      server = createTLSServer(credentials, accept)
    } else {
      server = createServer(accept)
    }

    server.on('error', (err: Error) => {
      lastError = err.message
      console.error(`IRC port: ${err.message}`)
    })

    /*
     * Wait for the bind before saying it is open.
     *
     * `listen` is asynchronous, so a status read straight afterwards says
     * "off" for a port that is about to work and "on" for one that is about to
     * fail with EADDRINUSE. Both are worse than waiting the millisecond it
     * takes to know.
     */
    const bound = server
    await new Promise<void>((resolve) => {
      const done = (): void => {
        bound.off('listening', onListening)
        bound.off('error', onError)
        resolve()
      }
      const onListening = (): void => {
        listening = { port: options.port, address, tls: !!options.tls }
        done()
      }
      const onError = (): void => {
        server = null
        done()
      }
      bound.once('listening', onListening)
      bound.once('error', onError)
      bound.listen(options.port, address)
    })

    if (listening) {
      console.info(
        `IRC port open on ${address}:${options.port}${options.tls ? ' (TLS)' : ''}` +
          `${options.password ? '' : ', no password'}`
      )
    }
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err)
    server = null
  }

  return bouncerStatus()
}

export function stopBouncer(): BouncerStatus {
  for (const session of [...sessions]) session.close()
  sessions.clear()
  server?.close()
  server = null
  listening = null
  return bouncerStatus()
}

export function bouncerStatus(): BouncerStatus {
  return {
    running: !!listening,
    port: listening?.port ?? null,
    address: listening?.address ?? null,
    tls: listening?.tls ?? false,
    clients: [...sessions].map((session) => ({
      id: session.id,
      name: session.clientName,
      network: session.boundTo
    })),
    error: lastError
  }
}

/** How many clients are attached, for the console and for status */
export function attachedClients(): number {
  return sessions.size
}
