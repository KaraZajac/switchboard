import { MAX_INCOMING } from '@shared/constants'
import { connectionProblem } from '@shared/connectionerror'
import { EventEmitter } from 'events'
import { stsUpgradeFor } from './features/sts'
import * as net from 'net'
import * as tls from 'tls'
import WebSocket from 'ws'
import type { IRCMessage } from '@shared/types/irc'
import type { ServerConfig } from '@shared/types/server'
import { parseMessage } from './parser'
import { reconnectDelay, THROTTLED_FLOOR_MS } from '@shared/reconnect'
import { redactLine } from '@shared/redact'
import { cmd } from './serializer'
import { decodeLine } from '@shared/decoding'
import { readCertificate } from '@shared/certfp'
import {
  proxyInUse,
  socks5Greeting,
  readSocks5Choice,
  socks5AuthRequest,
  readSocks5AuthReply,
  socks5Connect,
  readSocks5Reply,
  socks4Connect,
  readSocks4Reply,
  AUTH_USERPASS,
  AUTH_REJECTED,
  type ProxySettings
} from '@shared/socks'
import { readFileSync } from 'fs'

/**
 * The most a proxy may say before it has answered.
 *
 * The longest reply in either protocol is a SOCKS5 one carrying a domain name:
 * four bytes of header, a 255-byte name and a port. A kilobyte is room to
 * spare, and a proxy still talking past it is not answering.
 */
const MAX_PROXY_REPLY = 1024

/** How far through the proxy conversation one connection has got */
interface SocksProgress {
  stage: 'greeting' | 'authenticating' | 'connecting'
  proxy: ProxySettings
  /** Proxy bytes seen but not yet making up a whole reply */
  buffer: Buffer
}

/** How this machine reaches the internet, as the settings describe it */
export interface NetworkSettings {
  /** A SOCKS proxy to dial through, or null for straight out */
  proxy: ProxySettings | null
  /** A PEM file of extra certificate authorities to trust */
  caPath: string | null
}

let networkSettings: () => NetworkSettings = () => ({ proxy: null, caPath: null })

/**
 * Where connections get the machine's network settings.
 *
 * Injected rather than read here, so the protocol layer does not depend on
 * storage — which is what lets a connection be exercised without a database,
 * and is the whole reason the transport has tests at all. Read on each dial:
 * changing a proxy applies to the next connection, not the next launch.
 */
export function useNetworkSettings(source: () => NetworkSettings): void {
  networkSettings = source
}

function proxySettings(): ProxySettings | null {
  return networkSettings().proxy
}

/**
 * An extra certificate authority to trust, where one is configured.
 *
 * Read on each dial rather than cached, so pointing at a new file takes effect
 * on the next connection instead of the next launch. A path that cannot be
 * read is worth saying out loud once rather than silently connecting without
 * it and failing the handshake for a reason nobody could guess.
 */
let lastCaWarning = ''
function extraCertificateAuthority(): string | null {
  const path = networkSettings().caPath
  if (!path || path.trim().length === 0) return null
  try {
    return readFileSync(path.trim(), 'utf8')
  } catch (err) {
    const message = `Could not read the certificate authority at ${path}: ${String(err)}`
    if (message !== lastCaWarning) {
      lastCaWarning = message
      console.warn(message)
    }
    return null
  }
}

export interface ConnectionEvents {
  raw: (direction: 'in' | 'out', line: string) => void
  message: (msg: IRCMessage) => void
  connected: () => void
  disconnected: (reason: string) => void
  error: (error: Error) => void
}

// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export declare interface IRCConnection {
  on<K extends keyof ConnectionEvents>(event: K, listener: ConnectionEvents[K]): this
  off<K extends keyof ConnectionEvents>(event: K, listener: ConnectionEvents[K]): this
  emit<K extends keyof ConnectionEvents>(
    event: K,
    ...args: Parameters<ConnectionEvents[K]>
  ): boolean
}

/**
 * Manages a single IRC server connection over TCP/TLS.
 * Handles:
 * - Socket lifecycle (connect, disconnect, reconnect)
 * - Line buffering (IRC messages are \r\n delimited)
 * - Parsing incoming lines into IRCMessage objects
 * - Sending raw lines
 * - Automatic PING/PONG keepalive
 * - Reconnection with exponential backoff
 */

/**
 * The WebSocket subprotocols defined by the IRCv3 websocket specification.
 *
 * Both are offered and the server picks: text frames are UTF-8, binary frames
 * the same bytes unencoded. Either way a frame is one IRC line without CRLF.
 */
export const WEBSOCKET_SUBPROTOCOLS = ['text.ircv3.net', 'binary.ircv3.net']

/**
 * How many commands a client may send back to back.
 *
 * Servers implement a token bucket of roughly this shape — rIRCd allows 10,
 * solanum and its relatives about the same — and staying a little under leaves
 * room for the ones that are stricter.
 */
export const SEND_BURST = 5

/** Sustained rate once the burst is spent. irssi ships with much the same. */
export const SEND_RATE_PER_SECOND = 1

/**
 * Keepalive, which is answered out of band.
 *
 * A PONG held behind a queue gets us pinged out, and it belongs to no sequence,
 * so overtaking costs nothing.
 */
const ALWAYS_IMMEDIATE = new Set(['PING', 'PONG'])

/**
 * Commands servers exempt from flood control.
 *
 * They still go through the queue when anything is waiting in it. Overtaking
 * would reorder the stream — and a NICK landing between two lines of a
 * multiline batch is exactly the kind of thing that produces a bug report
 * nobody can reproduce.
 */
const FLOOD_EXEMPT = new Set(['CAP', 'NICK', 'USER', 'PASS', 'AUTHENTICATE', 'QUIT'])

function commandOf(line: string): string {
  // The command is the first token, unless the line carries tags or a prefix
  let rest = line
  if (rest.startsWith('@')) rest = rest.slice(rest.indexOf(' ') + 1).trimStart()
  if (rest.startsWith(':')) rest = rest.slice(rest.indexOf(' ') + 1).trimStart()
  return rest.split(' ', 1)[0].toUpperCase()
}

/** No line we send may contain a newline: it would end the command early */
function stripNewlines(line: string): string {
  return line.replace(/[\r\n]/g, '')
}

// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export class IRCConnection extends EventEmitter {
  readonly config: ServerConfig
  /** Lines waiting on the token bucket, oldest first */
  private readonly sendQueue: string[] = []
  private tokens = SEND_BURST
  private lastRefill = Date.now()
  private drainTimer: ReturnType<typeof setTimeout> | null = null

  private socket: net.Socket | tls.TLSSocket | null = null
  private ws: WebSocket | null = null
  private useWebSocket = false
  /** Bytes read but not yet ending a line. Bytes, not text: an encoding is
   *  chosen per line, and a multi-byte character can straddle two reads. */
  private buffer: Buffer = Buffer.alloc(0)

  /** True while the tail of an over-long line is still being thrown away */
  private discarding = false
  private _connected = false
  private reconnectAttempts = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private pingTimer: ReturnType<typeof setInterval> | null = null
  private lastPongAt = 0
  private intentionalDisconnect = false

  /**
   * Where we are in the proxy conversation, when there is one.
   *
   * `null` means there is no proxy, or it is done and the socket now carries
   * nothing but IRC. Until then every byte that arrives belongs to the proxy
   * and must not reach the line parser.
   */
  private socks: SocksProgress | null = null

  /**
   * What the server said in its last ERROR, which is usually why it hung up.
   *
   * Kept because the reconnect decision needs it: "Throttled: Reconnecting too
   * fast" is the server saying how to behave, and answering it with another
   * dial a second later is how a client stays throttled indefinitely.
   */
  private closingMessage: string | null = null
  /** Ping interval in ms */
  private static readonly PING_INTERVAL = 60_000
  /** Ping timeout in ms — disconnect if no PONG received */
  private static readonly PING_TIMEOUT = 30_000

  constructor(config: ServerConfig) {
    super()
    this.config = config
  }

  /**
   * The address this machine reached the server from.
   *
   * What a DCC offer has to carry. Taken from the socket rather than guessed:
   * a machine with several interfaces reaches different servers from different
   * addresses, and the one that matters is the one this connection is using.
   */
  localAddress(): string | null {
    const socket = this.socket
    if (!socket || !socket.localAddress) return null

    // Node reports an IPv4 address on a dual-stack socket as ::ffff:1.2.3.4,
    // and DCC has no way to carry that — the four octets are what it wants.
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(socket.localAddress)
    return mapped ? mapped[1] : socket.localAddress
  }

  get connected(): boolean {
    return this._connected
  }

  /**
   * Connect to the IRC server.
   */
  connect(): void {
    this.cleanup()
    this.intentionalDisconnect = false
    this.buffer = Buffer.alloc(0)
    this.discarding = false

    // WebSocket transport
    if (this.config.websocketUrl) {
      this.useWebSocket = true
      this.connectWebSocket(this.config.websocketUrl)
      return
    }

    this.useWebSocket = false

    // A server that has told us it is TLS-only gets reached over TLS, whatever
    // this server's saved settings say. Checked on every dial rather than only
    // when the policy arrives: the point of caching it is the connection
    // *after* the one that learned about it.
    const upgrade = stsUpgradeFor(this.config.host, this.config.port, this.config.tls)
    if (upgrade) {
      this.config.port = upgrade.port
      this.config.tls = true
    }

    // Through a proxy, when one is configured. The TCP connection goes to the
    // proxy and the proxy is asked for the server, so TLS — if any — is
    // negotiated afterwards, over the tunnel, against the real host's name.
    const proxy = proxySettings()
    if (proxy && proxyInUse(proxy)) {
      this.connectThroughProxy(proxy)
      return
    }

    const options = {
      host: this.config.host,
      port: this.config.port
    }

    if (this.config.tls) {
      this.socket = tls.connect(this.tlsOptions(options))
    } else {
      this.socket = net.connect(options)
    }

    this.bindSocket()
  }

  /**
   * What a TLS connection to this server should present and accept.
   *
   * Separated out because the proxy path needs the same answers a moment
   * later, over a socket that is already open.
   */
  private tlsOptions(base: object): tls.ConnectionOptions {
    // A client certificate, where one is set up. SASL EXTERNAL has nothing to
    // authenticate with unless the handshake presents it, which is why
    // choosing that mechanism used to end in 904 every time.
    const identity = readCertificate(this.config.clientCert)

    // A network running its own certificate authority — which is most private
    // and mesh networks — is otherwise unreachable, and the setting that was
    // meant to fix that was written down and never read by anything.
    const extra = extraCertificateAuthority()

    return {
      ...base,
      rejectUnauthorized: true,
      servername: this.config.host,
      ...(extra ? { ca: [...tls.rootCertificates, extra] } : {}),
      ...(identity ? { cert: identity.certificate, key: identity.privateKey } : {})
    }
  }

  private bindSocket(): void {
    if (!this.socket) return

    // Deliberately no setEncoding: lines arrive as bytes so each can be
    // decoded on its own. See `decodeLine`.
    this.socket.setTimeout(0) // No idle timeout — we use PING/PONG

    // A TLS socket emits 'connect' when the TCP connection is up and
    // 'secureConnect' once the handshake finishes. Registration must wait for the
    // handshake, so bind exactly one of them — binding both sends the whole
    // CAP LS / NICK / USER burst twice, which stalls or trips up strict servers.
    //
    // Through a proxy neither applies to the socket we open: it is connected
    // to the proxy, which is not the server. That path calls `onConnect` for
    // itself once the tunnel is up and, where the server wants TLS, once the
    // handshake over the tunnel has finished.
    if (this.socks) {
      // bound where the tunnel is opened
    } else if (this.config.tls) {
      this.socket.once('secureConnect', () => this.onConnect())
    } else {
      this.socket.once('connect', () => this.onConnect())
    }

    this.socket.on('data', (data: Buffer) => this.onData(data))
    this.socket.on('error', (err: Error) => this.onError(err))
    this.socket.on('close', () => this.onClose())
    this.socket.on('end', () => this.onEnd())
  }

  /**
   * Dial the proxy, then ask it for the server.
   *
   * The socket that opens is connected to the proxy, so nothing may be sent on
   * it until the tunnel is up — and every byte that arrives before then is the
   * proxy speaking, not the server. Both of those are why this is a small
   * state machine rather than a few writes: the replies are variable length,
   * they may arrive in pieces, and the byte after the last one is already the
   * IRC server's greeting.
   */
  private connectThroughProxy(proxy: ProxySettings): void {
    const port = Number(proxy.port)
    this.socks = { stage: 'greeting', proxy, buffer: Buffer.alloc(0) }

    this.socket = net.connect({ host: proxy.host.trim(), port })
    this.bindSocket()

    this.socket.once('connect', () => {
      if (!this.socket || !this.socks) return
      if (proxy.type === 'socks4') {
        this.socks.stage = 'connecting'
        this.socket.write(
          Buffer.from(socks4Connect(this.config.host, this.config.port, proxy.username ?? ''))
        )
        return
      }
      this.socket.write(Buffer.from(socks5Greeting(Boolean(proxy.username))))
    })
  }

  /**
   * One step of the proxy conversation.
   *
   * Returns the bytes that are not the proxy's — everything after the final
   * reply, which is the server talking and belongs to the line parser. The
   * proxy is finished the moment that happens and [socks] goes back to null.
   */
  private advanceProxy(data: Buffer): Buffer {
    const state = this.socks
    if (!state || !this.socket) return data

    state.buffer = Buffer.concat([state.buffer, data])

    // A SOCKS reply is a couple of hundred bytes at the very most. A proxy
    // that streams instead of answering is the same unbounded buffer the line
    // parser used to have, one layer further down — and this one runs before
    // there is any connection to report a problem on.
    if (state.buffer.length > MAX_PROXY_REPLY) {
      this.failProxy('The proxy sent more than a reply and never finished one')
      return Buffer.alloc(0)
    }

    const bytes = new Uint8Array(state.buffer)

    if (state.stage === 'greeting') {
      const method = readSocks5Choice(bytes)
      if (method === null) return Buffer.alloc(0)

      if (method === AUTH_REJECTED) {
        this.failProxy('The proxy would not accept how we offered to authenticate')
        return Buffer.alloc(0)
      }
      state.buffer = state.buffer.subarray(2)

      if (method === AUTH_USERPASS) {
        if (!state.proxy.username) {
          this.failProxy('The proxy wants a username and password, and none is saved for it')
          return Buffer.alloc(0)
        }
        state.stage = 'authenticating'
        this.socket.write(
          Buffer.from(socks5AuthRequest(state.proxy.username, state.proxy.password ?? ''))
        )
        return this.advanceProxy(Buffer.alloc(0))
      }

      state.stage = 'connecting'
      this.socket.write(Buffer.from(socks5Connect(this.config.host, this.config.port)))
      return this.advanceProxy(Buffer.alloc(0))
    }

    if (state.stage === 'authenticating') {
      const ok = readSocks5AuthReply(new Uint8Array(state.buffer))
      if (ok === null) return Buffer.alloc(0)
      state.buffer = state.buffer.subarray(2)

      if (!ok) {
        this.failProxy('The proxy refused the username and password')
        return Buffer.alloc(0)
      }
      state.stage = 'connecting'
      this.socket.write(Buffer.from(socks5Connect(this.config.host, this.config.port)))
      return this.advanceProxy(Buffer.alloc(0))
    }

    // 'connecting'
    const reply =
      state.proxy.type === 'socks4'
        ? readSocks4Reply(new Uint8Array(state.buffer))
        : readSocks5Reply(new Uint8Array(state.buffer))

    if (reply.ok === null) return Buffer.alloc(0)
    if (!reply.ok) {
      this.failProxy(reply.error ?? 'The proxy refused the connection')
      return Buffer.alloc(0)
    }

    // Anything past the reply is the server, which has not been introduced yet
    // but may already be talking.
    const rest = state.buffer.subarray(reply.length ?? state.buffer.length)
    this.socks = null
    this.openedThroughProxy(rest)
    return Buffer.alloc(0)
  }

  /**
   * The tunnel is up. From here it is an ordinary connection.
   *
   * With TLS the handshake happens now, over the tunnel and against the real
   * server's name — so a proxy cannot stand in the middle of it, and a
   * certificate for the proxy would be rejected the way it should be.
   */
  private openedThroughProxy(pending: Buffer): void {
    const raw = this.socket
    if (!raw) return

    if (!this.config.tls) {
      if (pending.length > 0) this.onData(pending)
      this.onConnect()
      return
    }

    // Whatever arrived early belongs to the TLS record layer, not to us
    if (pending.length > 0) raw.unshift(pending)

    const secure = tls.connect(this.tlsOptions({ socket: raw }))
    this.socket = secure
    this.bindSocket()
    secure.once('secureConnect', () => this.onConnect())
  }

  private failProxy(reason: string): void {
    this.socks = null
    this.emit('error', new Error(reason))
    // Closing here rather than waiting: a proxy that refused is not going to
    // change its mind on this socket, and leaving it open means the reconnect
    // ladder never starts.
    this.socket?.destroy()
  }

  private connectWebSocket(url: string): void {
    // The subprotocols the IRCv3 WebSocket spec defines. A server that follows
    // it will not accept a connection asking for anything else, so getting
    // these wrong does not degrade the transport — it removes it.
    this.ws = new WebSocket(url, WEBSOCKET_SUBPROTOCOLS, {
      rejectUnauthorized: true
    })

    this.ws.on('open', () => this.onConnect())

    this.ws.on('message', (data: WebSocket.Data) => {
      // One frame is one IRC line, with no CRLF of its own — under either
      // subprotocol, since a text frame is UTF-8 and a binary one carries the
      // same bytes. The parser wants terminated lines, so put it back.
      // A text frame is already UTF-8 by the WebSocket spec; a binary one
      // carries the same bytes an ordinary socket would.
      const bytes =
        typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(data as Buffer)
      const trimmed = bytes.subarray(
        0,
        bytes.length - (bytes.at(-1) === 0x0a ? (bytes.at(-2) === 0x0d ? 2 : 1) : 0)
      )
      this.onData(Buffer.concat([trimmed, Buffer.from('\r\n')]))
    })

    this.ws.on('error', (err: Error) => this.onError(err))
    this.ws.on('close', () => this.onClose())
  }

  /**
   * Disconnect from the server.
   */
  disconnect(reason = 'Leaving'): void {
    this.intentionalDisconnect = true
    if (this._connected) {
      // Whatever is still queued is for a conversation we are leaving, and
      // holding QUIT behind it would only delay a clean goodbye.
      this.clearQueue()
      this.sendRaw(cmd('QUIT', reason))
    }
    // Give the server a moment to process QUIT before closing
    setTimeout(() => this.cleanup(), 500)
  }

  /**
   * Send a raw IRC line to the server.
   *
   * Queued and paced, because every ircd since 1993 has a send-queue limit and
   * punishes clients that ignore it — by silently dropping commands, or by
   * killing the connection with "Excess Flood". Connecting is exactly when a
   * client wants to say the most at once (subscribe, publish a profile, join,
   * ask for history and names), so it is exactly when the limit bites.
   *
   * Registration and keepalive bypass the queue: servers exempt those, and
   * delaying a PONG would get us pinged out.
   */
  sendRaw(line: string): void {
    // Newlines come out at the socket, in writeLine. Stripped here too so that
    // what the flood queue counts and what the server receives are the same
    // line.
    const sanitized = stripNewlines(line)

    const command = commandOf(sanitized)

    // Keepalive always goes now. Registration goes now too, but only while
    // nothing is waiting — which is every time it actually happens.
    if (
      ALWAYS_IMMEDIATE.has(command) ||
      (FLOOD_EXEMPT.has(command) && this.sendQueue.length === 0)
    ) {
      this.writeLine(sanitized)
      return
    }

    this.sendQueue.push(sanitized)
    this.drainQueue()
  }

  /**
   * Send what the bucket allows, and schedule the rest.
   *
   * A token bucket rather than a fixed delay: a client that has been quiet can
   * say several things at once, which is what makes joining a few channels feel
   * instant, while a sustained stream settles to a rate servers accept.
   */
  private drainQueue(): void {
    const now = Date.now()
    this.tokens = Math.min(
      SEND_BURST,
      this.tokens + ((now - this.lastRefill) / 1000) * SEND_RATE_PER_SECOND
    )
    this.lastRefill = now

    while (this.sendQueue.length > 0 && this.tokens >= 1) {
      this.tokens -= 1
      this.writeLine(this.sendQueue.shift() as string)
    }

    if (this.sendQueue.length === 0) {
      if (this.drainTimer) clearTimeout(this.drainTimer)
      this.drainTimer = null
      return
    }

    if (this.drainTimer) return
    const waitMs = Math.ceil(((1 - this.tokens) / SEND_RATE_PER_SECOND) * 1000)
    this.drainTimer = setTimeout(
      () => {
        this.drainTimer = null
        this.drainQueue()
      },
      Math.max(waitMs, 10)
    )
  }

  /** Anything still queued is not worth sending to a server we have left */
  private clearQueue(): void {
    this.sendQueue.length = 0
    if (this.drainTimer) clearTimeout(this.drainTimer)
    this.drainTimer = null
    this.tokens = SEND_BURST
    this.lastRefill = Date.now()
  }

  /**
   * The one place every byte we send passes through.
   *
   * A newline inside a command ends it and starts another, which turns
   * anything built from typed text into a way to send commands nobody typed.
   * Stripping them here rather than only at the queue means a caller that
   * writes straight to the socket cannot miss it.
   */
  private writeLine(raw: string): void {
    const line = stripNewlines(raw)
    if (this.useWebSocket) {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
      this.ws.send(line)
    } else {
      if (!this.socket || this.socket.destroyed) return
      this.socket.write(line + '\r\n')
    }
    // Redacted at the source, so the secret is not in the renderer, a log,
    // or a devtools window either — see `@shared/redact`.
    this.emit('raw', 'out', redactLine(line))
  }

  /**
   * Send a parsed command with params.
   */
  send(command: string, ...params: string[]): void {
    this.sendRaw(cmd(command, ...params))
  }

  // ── Socket event handlers ────────────────────────────────────────

  private onConnect(): void {
    // For plain TCP, this fires on 'connect'
    // For TLS, we bind this to 'secureConnect' instead
    if (this.config.tls && !(this.socket as tls.TLSSocket)?.authorized) {
      // TLS verification failed — secureConnect still fires but authorized is false
      const err = (this.socket as tls.TLSSocket).authorizationError
      if (err) {
        // In words, where we have them: `ERR_TLS_CERT_ALTNAME_INVALID` is
        // accurate and tells nobody that this might not be the server they
        // meant. See `@shared/connectionerror` — the phone says the same.
        this.emit('error', new Error(connectionProblem(String(err), this.config.host)))
        this.cleanup()
        return
      }
    }

    this._connected = true
    // Deliberately not clearing `reconnectAttempts` here. A socket that opens
    // is not a server that let us in: a connect throttle, a full server, a ban
    // and a TLS-only port all accept the connection and then close it.
    // Resetting here pinned the counter at zero and redialled at the base
    // delay for ever. `registered` is what clears it — see onRegistered().
    this.lastPongAt = Date.now()
    this.startPingTimer()
    this.emit('connected')
  }

  private onData(data: Buffer): void {
    // While a proxy is still being talked to, none of this is IRC.
    if (this.socks) {
      const rest = this.advanceProxy(data)
      if (rest.length === 0) return
      data = rest
    }

    this.buffer = this.buffer.length === 0 ? data : Buffer.concat([this.buffer, data])

    const lines: Buffer[] = []
    let from = 0
    for (;;) {
      const at = this.buffer.indexOf('\r\n', from)
      if (at === -1) break
      lines.push(this.buffer.subarray(from, at))
      from = at + 2
    }
    // Keep the last (possibly incomplete) chunk in the buffer
    this.buffer = this.buffer.subarray(from)

    // A line longer than this is not one any server may send, and holding on
    // for the rest of it is how a socket that never sends \r\n becomes an
    // out-of-memory. Drop what is held, and drop the rest of that line too —
    // otherwise its tail arrives as the start of the next one, which is worse
    // than losing it, because half a line still parses.
    if (this.buffer.length > MAX_INCOMING) {
      this.buffer = Buffer.alloc(0)
      this.discarding = true
    }

    for (const raw of lines) {
      if (this.discarding) {
        // The end of the line we gave up on, not a line of its own
        this.discarding = false
        continue
      }
      if (raw.length === 0) continue
      const line = decodeLine(raw)
      this.emit('raw', 'in', line)

      try {
        const msg = parseMessage(line)
        // Handle PING internally for keepalive
        if (msg.command === 'PING') {
          this.sendRaw(cmd('PONG', ...msg.params))
          continue
        }
        if (msg.command === 'PONG') {
          this.lastPongAt = Date.now()
          continue
        }
        this.emit('message', msg)
      } catch (err) {
        this.emit('error', err instanceof Error ? err : new Error(String(err)))
      }
    }
  }

  private onError(err: Error): void {
    this.emit('error', err)
  }

  private onEnd(): void {
    // Server closed its side of the connection
  }

  private onClose(): void {
    const wasConnected = this._connected
    this._connected = false
    this.stopPingTimer()

    if (wasConnected) {
      this.emit('disconnected', this.intentionalDisconnect ? 'User quit' : 'Connection lost')
    }

    if (!this.intentionalDisconnect) {
      this.scheduleReconnect()
    }
  }

  // ── Reconnection ─────────────────────────────────────────────────

  /**
   * The server let us in, so the last attempt worked.
   *
   * Called on 001 rather than on the socket opening, which is the whole of
   * this fix — see `@shared/reconnect`.
   */
  onRegistered(): void {
    this.reconnectAttempts = 0
    this.closingMessage = null
  }

  /** What the server said as it closed, for the reconnect decision */
  noteClosingMessage(message: string): void {
    this.closingMessage = message
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return

    this.reconnectAttempts++
    const delay = reconnectDelay(this.reconnectAttempts, this.closingMessage)
    if (delay >= THROTTLED_FLOOR_MS) {
      console.info(
        `${this.config.host}: waiting ${Math.round(delay / 1000)}s — ${this.closingMessage}`
      )
    }

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, delay)
  }

  cancelReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  // ── PING/PONG keepalive ──────────────────────────────────────────

  private startPingTimer(): void {
    this.stopPingTimer()
    this.pingTimer = setInterval(() => {
      if (!this._connected) return

      // Check if last PONG was too long ago
      if (Date.now() - this.lastPongAt > IRCConnection.PING_INTERVAL + IRCConnection.PING_TIMEOUT) {
        this.emit('error', new Error('Ping timeout'))
        this.cleanup()
        return
      }

      this.sendRaw(cmd('PING', Date.now().toString()))
    }, IRCConnection.PING_INTERVAL)
  }

  private stopPingTimer(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer)
      this.pingTimer = null
    }
  }

  // ── Cleanup ──────────────────────────────────────────────────────

  private cleanup(): void {
    this.clearQueue()
    this.stopPingTimer()
    this._connected = false

    if (this.ws) {
      this.ws.removeAllListeners()
      this.ws.close()
      this.ws = null
    }

    if (this.socket) {
      this.socket.removeAllListeners()
      this.socket.destroy()
      this.socket = null
    }
  }

  /**
   * Fully destroy this connection — no reconnect, all listeners removed.
   */
  destroy(): void {
    this.intentionalDisconnect = true
    this.cancelReconnect()
    this.cleanup()
    this.removeAllListeners()
  }
}
