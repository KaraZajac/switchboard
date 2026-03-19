import { EventEmitter } from 'events'
import * as net from 'net'
import * as tls from 'tls'
import WebSocket from 'ws'
import type { IRCMessage } from '@shared/types/irc'
import type { ServerConfig } from '@shared/types/server'
import { parseMessage } from './parser'
import { cmd } from './serializer'

export interface ConnectionEvents {
  raw: (direction: 'in' | 'out', line: string) => void
  message: (msg: IRCMessage) => void
  connected: () => void
  disconnected: (reason: string) => void
  error: (error: Error) => void
}

export declare interface IRCConnection {
  on<K extends keyof ConnectionEvents>(event: K, listener: ConnectionEvents[K]): this
  off<K extends keyof ConnectionEvents>(event: K, listener: ConnectionEvents[K]): this
  emit<K extends keyof ConnectionEvents>(event: K, ...args: Parameters<ConnectionEvents[K]>): boolean
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
export class IRCConnection extends EventEmitter {
  readonly config: ServerConfig
  private socket: net.Socket | tls.TLSSocket | null = null
  private ws: WebSocket | null = null
  private useWebSocket = false
  private buffer = ''
  private _connected = false
  private reconnectAttempts = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private pingTimer: ReturnType<typeof setInterval> | null = null
  private lastPongAt = 0
  private intentionalDisconnect = false

  /** Max reconnect delay in ms */
  private static readonly MAX_RECONNECT_DELAY = 300_000 // 5 minutes
  /** Base reconnect delay in ms */
  private static readonly BASE_RECONNECT_DELAY = 1_000
  /** Ping interval in ms */
  private static readonly PING_INTERVAL = 60_000
  /** Ping timeout in ms — disconnect if no PONG received */
  private static readonly PING_TIMEOUT = 30_000

  constructor(config: ServerConfig) {
    super()
    this.config = config
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
    this.buffer = ''

    // WebSocket transport
    if (this.config.websocketUrl) {
      this.useWebSocket = true
      this.connectWebSocket(this.config.websocketUrl)
      return
    }

    this.useWebSocket = false
    const options = {
      host: this.config.host,
      port: this.config.port
    }

    if (this.config.tls) {
      this.socket = tls.connect({
        ...options,
        rejectUnauthorized: true,
        servername: this.config.host
      })
    } else {
      this.socket = net.connect(options)
    }

    this.socket.setEncoding('utf8')
    this.socket.setTimeout(0) // No idle timeout — we use PING/PONG

    this.socket.on('connect', () => this.onConnect())
    this.socket.on('secureConnect', () => {
      // For TLS, 'connect' fires first, then 'secureConnect' after handshake.
    })
    this.socket.on('data', (data: string) => this.onData(data))
    this.socket.on('error', (err: Error) => this.onError(err))
    this.socket.on('close', () => this.onClose())
    this.socket.on('end', () => this.onEnd())

    // For TLS, wait for secureConnect before sending registration
    if (this.config.tls) {
      ;(this.socket as tls.TLSSocket).once('secureConnect', () => {
        this.onConnect()
      })
    }
  }

  private connectWebSocket(url: string): void {
    this.ws = new WebSocket(url, ['irc'], {
      rejectUnauthorized: true
    })

    this.ws.on('open', () => this.onConnect())

    this.ws.on('message', (data: WebSocket.Data) => {
      const str = typeof data === 'string' ? data : data.toString('utf8')
      this.onData(str + '\r\n')
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
      this.sendRaw(cmd('QUIT', reason))
    }
    // Give the server a moment to process QUIT before closing
    setTimeout(() => this.cleanup(), 500)
  }

  /**
   * Send a raw IRC line to the server.
   * Appends \r\n automatically.
   */
  sendRaw(line: string): void {
    // Prevent injection: strip any embedded newlines
    const sanitized = line.replace(/[\r\n]/g, '')

    if (this.useWebSocket) {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
      this.ws.send(sanitized)
    } else {
      if (!this.socket || this.socket.destroyed) return
      this.socket.write(sanitized + '\r\n')
    }
    this.emit('raw', 'out', sanitized)
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
        this.emit('error', new Error(`TLS certificate error: ${err}`))
        this.cleanup()
        return
      }
    }

    this._connected = true
    this.reconnectAttempts = 0
    this.lastPongAt = Date.now()
    this.startPingTimer()
    this.emit('connected')
  }

  private onData(data: string): void {
    this.buffer += data
    const lines = this.buffer.split('\r\n')
    // Keep the last (possibly incomplete) chunk in the buffer
    this.buffer = lines.pop() || ''

    for (const line of lines) {
      if (line.length === 0) continue
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

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return

    const delay = Math.min(
      IRCConnection.BASE_RECONNECT_DELAY * Math.pow(2, this.reconnectAttempts),
      IRCConnection.MAX_RECONNECT_DELAY
    )
    this.reconnectAttempts++

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
