import type { RegistrationState, IRCBatch } from '@shared/types/irc'
import type { ChannelUser } from '@shared/types/channel'

/**
 * Per-connection state tracking.
 * Maintains all runtime state for a single IRC server connection.
 */
export class ConnectionState {
  /** Current registration state */
  registrationState: RegistrationState = 'disconnected'

  /** Our current nickname on this server */
  nick = ''

  /** Desired nickname (what we requested) */
  desiredNick = ''

  /** Username sent during registration */
  username = ''

  /** Realname sent during registration */
  realname = ''

  /** Server name (from 001 or prefix) */
  serverName = ''

  /** Negotiated capabilities */
  capabilities = new Set<string>()

  /** Available capabilities (from CAP LS) */
  availableCapabilities = new Map<string, string | null>()

  /** Whether CAP negotiation is in progress */
  capNegotiating = false

  /** ISUPPORT tokens (from 005 RPL_ISUPPORT) */
  isupport: Record<string, string | true> = {}

  /** Channels we are currently in */
  channels = new Map<string, ChannelStateData>()

  /** Active batches being assembled */
  batches = new Map<string, IRCBatch>()

  /** MOTD lines being accumulated */
  motdLines: string[] = []

  /** Whether MOTD is currently being received */
  motdInProgress = false

  /** WHOIS response accumulator */
  whoisData: Record<string, string> | null = null

  /** Latency from last PING/PONG round-trip (ms) */
  latencyMs: number | null = null

  /** Reset all state for a new connection */
  reset(): void {
    this.registrationState = 'disconnected'
    this.nick = ''
    this.serverName = ''
    this.capabilities.clear()
    this.availableCapabilities.clear()
    this.capNegotiating = false
    this.isupport = {}
    this.channels.clear()
    this.batches.clear()
    this.motdLines = []
    this.motdInProgress = false
    this.whoisData = null
    this.latencyMs = null
  }

  /** Get or create channel state */
  getChannel(name: string): ChannelStateData {
    const lower = name.toLowerCase()
    let ch = this.channels.get(lower)
    if (!ch) {
      ch = new ChannelStateData(name)
      this.channels.set(lower, ch)
    }
    return ch
  }

  /** Remove a channel from tracking */
  removeChannel(name: string): void {
    this.channels.delete(name.toLowerCase())
  }

  /** Check if we're in a channel */
  inChannel(name: string): boolean {
    return this.channels.has(name.toLowerCase())
  }

  /** Get the CASEMAPPING function based on ISUPPORT */
  casemap(str: string): string {
    const mapping = this.isupport['CASEMAPPING']
    if (mapping === 'ascii' || mapping === true) {
      return str.toLowerCase()
    }
    // Default to rfc1459 casemapping
    return str.toLowerCase()
      .replace(/\[/g, '{')
      .replace(/\]/g, '}')
      .replace(/\\/g, '|')
      .replace(/~/g, '^')
  }
}

/**
 * State for a single channel.
 */
export class ChannelStateData {
  /** Channel name (original case) */
  name: string

  /** Channel topic */
  topic: string | null = null

  /** Who set the topic */
  topicSetBy: string | null = null

  /** When the topic was set (ISO timestamp) */
  topicSetAt: string | null = null

  /** Channel modes */
  modes: Record<string, string | true> = {}

  /** Users in the channel, keyed by lowercase nick */
  users = new Map<string, ChannelUser>()

  /** Whether we've received the initial NAMES list */
  namesReceived = false

  constructor(name: string) {
    this.name = name
  }

  /** Add or update a user in the channel */
  setUser(nick: string, data: Partial<ChannelUser>): ChannelUser {
    const lower = nick.toLowerCase()
    const existing = this.users.get(lower)
    const user: ChannelUser = {
      nick: data.nick ?? existing?.nick ?? nick,
      user: data.user ?? existing?.user ?? null,
      host: data.host ?? existing?.host ?? null,
      account: data.account ?? existing?.account ?? null,
      realname: data.realname ?? existing?.realname ?? null,
      prefixes: data.prefixes ?? existing?.prefixes ?? [],
      away: data.away ?? existing?.away ?? false,
      awayMessage: data.awayMessage ?? existing?.awayMessage ?? null,
      isBot: data.isBot ?? existing?.isBot ?? false
    }
    this.users.set(lower, user)
    return user
  }

  /** Remove a user from the channel */
  removeUser(nick: string): void {
    this.users.delete(nick.toLowerCase())
  }

  /** Rename a user in the channel */
  renameUser(oldNick: string, newNick: string): void {
    const lower = oldNick.toLowerCase()
    const user = this.users.get(lower)
    if (user) {
      this.users.delete(lower)
      user.nick = newNick
      this.users.set(newNick.toLowerCase(), user)
    }
  }

  /** Check if a nick is in the channel */
  hasUser(nick: string): boolean {
    return this.users.has(nick.toLowerCase())
  }
}
