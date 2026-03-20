import { EventEmitter } from 'events'
import type { IRCMessage } from '@shared/types/irc'
import type { ServerConfig } from '@shared/types/server'
import type { ChannelUser } from '@shared/types/channel'
import { IRCConnection } from './connection'
import { ConnectionState } from './state'
import { dispatchMessage, registerAllHandlers } from './handlers/index'
import { REQUESTED_CAPS } from '@shared/constants'
import { cmd } from './serializer'

// Register all handlers once at module load
registerAllHandlers()

/**
 * Events emitted by IRCClient to the application layer.
 */
export interface ClientEvents {
  // Connection lifecycle
  registered: (data: { nick: string; message: string }) => void
  disconnected: (reason: string) => void
  connectionError: (error: Error) => void

  // Channel events
  join: (data: { channel: string; user: ChannelUser; isMe: boolean }) => void
  part: (data: { channel: string; nick: string; reason: string | null; isMe: boolean }) => void
  kick: (data: { channel: string; nick: string; by: string; reason: string | null; isMe: boolean }) => void
  topic: (data: { channel: string; topic: string; setBy: string | null }) => void
  names: (data: { channel: string; users: ChannelUser[] }) => void
  mode: (data: { channel: string; mode: string; params: string[]; setBy: string | null }) => void
  invite: (data: { channel: string; by: string; target: string; isMe: boolean }) => void

  // Message events
  privmsg: (data: {
    channel: string
    nick: string
    content: string
    type: 'privmsg' | 'action'
    isPrivate: boolean
    isEcho: boolean
    msgid?: string
    time: string
    account?: string
    replyTo?: string
    label?: string
    userHost: string | null
    tags: Record<string, string | true>
  }) => void
  notice: (data: {
    channel: string
    nick: string
    content: string
    type: 'notice'
    isPrivate: boolean
    msgid?: string
    time: string
    tags: Record<string, string | true>
  }) => void
  tagmsg: (data: {
    channel: string
    nick: string
    tags: Record<string, string | true>
  }) => void

  // User events
  nick: (data: { oldNick: string; newNick: string }) => void
  quit: (data: { nick: string; reason: string | null }) => void
  typing: (data: { channel: string; nick: string; status: 'active' | 'paused' | 'done' }) => void
  react: (data: { channel: string; nick: string; emoji: string; msgid: string }) => void
  away: (data: { nick: string; message: string | null }) => void
  account: (data: { nick: string; account: string | null }) => void

  // Metadata
  metadata: (data: { target: string; key: string; value: string }) => void
  setname: (data: { nick: string; realname: string }) => void

  // Server events
  motd: (lines: string[]) => void
  isupport: (tokens: Record<string, string | true>) => void
  nickInUse: (data: { nick: string; message: string }) => void
  capNegotiated: (caps: string[]) => void

  // Standard replies
  error: (data: { code: string; command: string; message: string }) => void
  warn: (data: { code: string; command: string; message: string }) => void
  note: (data: { code: string; command: string; message: string }) => void

  // WHOIS
  whois: (data: Record<string, string>) => void

  // Channel list (LIST)
  channelList: (channels: { name: string; userCount: number; topic: string }[]) => void

  // Raw (for debug view)
  raw: (direction: 'in' | 'out', line: string) => void
}

// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export declare interface IRCClient {
  events: EventEmitter & {
    on<K extends keyof ClientEvents>(event: K, listener: ClientEvents[K]): EventEmitter
    off<K extends keyof ClientEvents>(event: K, listener: ClientEvents[K]): EventEmitter
    emit<K extends keyof ClientEvents>(event: K, ...args: Parameters<ClientEvents[K]>): boolean
  }
}

/**
 * High-level IRC client that wraps connection, state, and protocol handling.
 *
 * Usage:
 *   const client = new IRCClient(serverConfig)
 *   client.events.on('privmsg', (data) => { ... })
 *   client.connect()
 */
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export class IRCClient {
  readonly config: ServerConfig
  readonly connection: IRCConnection
  readonly state: ConnectionState
  readonly events: EventEmitter

  constructor(config: ServerConfig) {
    this.config = config
    this.connection = new IRCConnection(config)
    this.state = new ConnectionState()
    this.events = new EventEmitter()

    this.state.desiredNick = config.nick
    this.state.username = config.username || config.nick
    this.state.realname = config.realname || config.nick

    this.setupConnectionListeners()
  }

  // ── Public API ───────────────────────────────────────────────────

  /**
   * Connect to the server.
   */
  connect(): void {
    this.state.reset()
    this.state.registrationState = 'connecting'
    this.connection.connect()
  }

  /**
   * Disconnect from the server.
   */
  disconnect(reason?: string): void {
    this.connection.disconnect(reason)
  }

  /**
   * Join a channel.
   */
  join(channel: string, key?: string): void {
    if (key) {
      this.connection.send('JOIN', channel, key)
    } else {
      this.connection.send('JOIN', channel)
    }
  }

  /**
   * Leave a channel.
   */
  part(channel: string, reason?: string): void {
    if (reason) {
      this.connection.send('PART', channel, reason)
    } else {
      this.connection.send('PART', channel)
    }
  }

  /**
   * Send a message to a channel or user.
   */
  say(target: string, message: string): void {
    this.connection.send('PRIVMSG', target, message)
  }

  /**
   * Send a NOTICE to a channel or user.
   */
  notice(target: string, message: string): void {
    this.connection.send('NOTICE', target, message)
  }

  /**
   * Send a CTCP ACTION (/me).
   */
  action(target: string, text: string): void {
    this.connection.send('PRIVMSG', target, `\x01ACTION ${text}\x01`)
  }

  /**
   * Change our nickname.
   */
  setNick(nick: string): void {
    this.state.desiredNick = nick
    this.connection.send('NICK', nick)
  }

  /**
   * Set or change the topic of a channel.
   */
  setTopic(channel: string, topic: string): void {
    this.connection.send('TOPIC', channel, topic)
  }

  /**
   * Kick a user from a channel.
   */
  kick(channel: string, nick: string, reason?: string): void {
    if (reason) {
      this.connection.send('KICK', channel, nick, reason)
    } else {
      this.connection.send('KICK', channel, nick)
    }
  }

  /**
   * Set a mode on a channel or user.
   */
  mode(target: string, mode: string, ...params: string[]): void {
    this.connection.send('MODE', target, mode, ...params)
  }

  /**
   * Send a WHOIS query.
   */
  whois(nick: string): void {
    this.connection.send('WHOIS', nick)
  }

  /**
   * Destroy the client — disconnect and clean up everything.
   */
  destroy(): void {
    this.connection.destroy()
    this.events.removeAllListeners()
  }

  // ── Internal setup ───────────────────────────────────────────────

  private setupConnectionListeners(): void {
    // Forward raw lines to the events emitter
    this.connection.on('raw', (direction, line) => {
      this.events.emit('raw', direction, line)
    })

    // When the socket connects, begin IRC registration
    this.connection.on('connected', () => {
      this.state.registrationState = 'registering'
      this.beginRegistration()
    })

    // Route parsed messages through the handler system
    this.connection.on('message', (msg: IRCMessage) => {
      dispatchMessage(this, msg)
    })

    this.connection.on('disconnected', (reason) => {
      this.state.registrationState = 'disconnected'
      this.events.emit('disconnected', reason)
    })

    this.connection.on('error', (err) => {
      this.events.emit('connectionError', err)
    })
  }

  /**
   * Begin IRC connection registration.
   *
   * Order:
   * 1. CAP LS 302 (request capability listing)
   * 2. PASS (if server password configured)
   * 3. NICK
   * 4. USER
   *
   * CAP negotiation runs concurrently — we send CAP LS then
   * continue with NICK/USER. The server holds registration
   * until we send CAP END.
   */
  private beginRegistration(): void {
    // Start capability negotiation
    this.connection.send('CAP', 'LS', '302')
    this.state.capNegotiating = true

    // Server password
    if (this.config.password) {
      this.connection.send('PASS', this.config.password)
    }

    // NICK and USER
    this.connection.send('NICK', this.state.desiredNick)
    this.state.nick = this.state.desiredNick
    this.connection.send(
      'USER',
      this.state.username,
      '0',
      '*',
      this.state.realname
    )
  }
}
