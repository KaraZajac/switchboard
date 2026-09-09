import type { RegistrationState, IRCBatch } from '@shared/types/irc'
import { foldCase, casemappingOf } from '@shared/casemap'
import type { ChannelUser } from '@shared/types/channel'
import type { UserMetadata } from '@shared/types/metadata'

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

  /**
   * A nick we have asked for and not yet had an answer to.
   *
   * The answer is normally a NICK echoed back with our *old* nick in the
   * prefix, which is how a client recognises its own change. Not every server
   * does that — at least one sends the new nick in the prefix, which matches
   * nobody and leaves the client convinced it is still called something else
   * for the rest of the session. Knowing what we asked for settles it.
   */
  pendingNick: string | null = null

  /**
   * Our own `user@host`, once the server has shown it to us.
   *
   * Learned from our own JOIN, which carries the full mask. It is what the
   * server prepends to everything we say, so it is the difference between
   * knowing how much room a message has and guessing.
   */
  userHost: string | null = null

  /** CAP REQ lines still waiting for an ACK or NAK */
  pendingCapRequests = 0

  /** Username sent during registration */
  username = ''

  /** Realname sent during registration */
  realname = ''

  /** Whether we are currently marked as away */
  away = false

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

  /**
   * draft/metadata-2 values, keyed by lowercase target (nick or channel).
   *
   * Held here rather than only in the UI so a reloading window — or a phone
   * pairing for the first time — sees the same display names and colours the
   * desktop is already showing.
   */
  metadata = new Map<string, UserMetadata>()

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

  /** LIST response accumulator */
  listEntries: { name: string; userCount: number; topic: string }[] = []

  /** Whether a LIST response is being received */
  listInProgress = false

  /** Reset all state for a new connection */
  reset(): void {
    this.registrationState = 'disconnected'
    this.nick = ''
    this.pendingNick = null
    this.userHost = null
    this.serverName = ''
    this.capabilities.clear()
    this.availableCapabilities.clear()
    this.capNegotiating = false
    this.pendingCapRequests = 0
    this.isupport = {}
    this.metadata.clear()
    this.channels.clear()
    this.batches.clear()
    this.motdLines = []
    this.motdInProgress = false
    this.whoisData = null
    this.latencyMs = null
    this.listEntries = []
    this.listInProgress = false
  }

  /** Get or create channel state */
  getChannel(name: string): ChannelStateData {
    const key = this.casemap(name)
    let ch = this.channels.get(key)
    if (!ch) {
      ch = new ChannelStateData(name, (nick) => this.casemap(nick))
      this.channels.set(key, ch)
    }
    return ch
  }

  /** Remove a channel from tracking */
  removeChannel(name: string): void {
    this.channels.delete(this.casemap(name))
  }

  /** Check if we're in a channel */
  inChannel(name: string): boolean {
    return this.channels.has(this.casemap(name))
  }

  /**
   * A name as this server would compare it.
   *
   * Read from ISUPPORT every time rather than cached, because `005` arrives
   * after the state object exists and a stale answer here means two spellings
   * of one nick living in the map as two people.
   */
  casemap(name: string): string {
    return foldCase(name, casemappingOf(this.isupport['CASEMAPPING']))
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

  /** Users in the channel, keyed by the folded nick */
  users = new Map<string, ChannelUser>()

  /** Whether we've received the initial NAMES list */
  namesReceived = false

  /**
   * How this server folds a nick.
   *
   * Passed in rather than looked up, because a channel has no view of
   * ISUPPORT — and taken as a function rather than a value so it keeps
   * answering correctly if `005` arrives after the channel exists.
   */
  private readonly fold: (nick: string) => string

  constructor(name: string, fold: (nick: string) => string = (nick) => foldCase(nick)) {
    this.name = name
    this.fold = fold
  }

  /** Add or update a user in the channel */
  setUser(nick: string, data: Partial<ChannelUser>): ChannelUser {
    const lower = this.fold(nick)
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
    this.users.delete(this.fold(nick))
  }

  /** Rename a user in the channel */
  renameUser(oldNick: string, newNick: string): void {
    const lower = this.fold(oldNick)
    const user = this.users.get(lower)
    if (user) {
      this.users.delete(lower)
      user.nick = newNick
      this.users.set(this.fold(newNick), user)
    }
  }

  /** Check if a nick is in the channel */
  hasUser(nick: string): boolean {
    return this.users.has(this.fold(nick))
  }
}
