import type { SASLMechanism } from './irc'
import type { UserMetadata } from './metadata'

/** Server connection configuration */
export interface ServerConfig {
  id: string
  name: string
  host: string
  port: number
  tls: boolean
  password: string | null
  nick: string
  username: string
  realname: string
  saslMechanism: SASLMechanism | null
  saslUsername: string | null
  saslPassword: string | null
  /**
   * Credentials that are stored and cannot be read back.
   *
   * A moved profile or a reset keyring leaves the ciphertext behind with no
   * key for it. Naming the fields rather than guessing lets the connection
   * stop instead of authenticating with an empty string — which the server
   * refuses, and which then reads as the password being wrong.
   *
   * Field names only. Never a value, and never why.
   */
  unreadableSecrets?: string[]
  autoConnect: boolean
  autoJoin: string[]
  /** Command to run after connecting, e.g. "/msg NickServ IDENTIFY user pass" */
  identifyCommand: string | null
  /**
   * Lines to send once this network is ready, one per line.
   *
   * A leading slash means a command and anything else is raw IRC, which is
   * what every other client's "perform" does. Separate from `identifyCommand`
   * because that one is a credential — encrypted, and stripped on the way to a
   * paired device — and these are not.
   */
  performOnConnect: string | null
  sortOrder: number
  /** WebSocket URL (ws:// or wss://) — if set, connect via WebSocket instead of TCP */
  websocketUrl: string | null
  /** Locally persisted avatar URL for draft/metadata-2 (legacy; see profile) */
  avatarUrl: string | null
  /** Our own draft/metadata-2 profile, republished on every connect */
  profile: UserMetadata
  /** Away message to set before registration (draft/pre-away, bouncer support) */
  preAwayMessage: string | null
  /**
   * A client certificate and its key, in PEM, for SASL EXTERNAL.
   *
   * A credential, kept encrypted beside the passwords and stripped on the way
   * to a paired device by the same rule.
   */
  clientCert: string | null
}

/** Runtime server state (not persisted) */
export interface ServerState {
  id: string
  config: ServerConfig
  connected: boolean
  currentNick: string
  capabilities: Set<string>
  isupport: Record<string, string | true>
  motd: string[]
  latencyMs: number | null
}
