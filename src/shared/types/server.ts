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
  autoConnect: boolean
  autoJoin: string[]
  /** Command to run after connecting, e.g. "/msg NickServ IDENTIFY user pass" */
  identifyCommand: string | null
  sortOrder: number
  /** WebSocket URL (ws:// or wss://) — if set, connect via WebSocket instead of TCP */
  websocketUrl: string | null
  /** Locally persisted avatar URL for draft/metadata-2 (legacy; see profile) */
  avatarUrl: string | null
  /** Our own draft/metadata-2 profile, republished on every connect */
  profile: UserMetadata
  /** Away message to set before registration (draft/pre-away, bouncer support) */
  preAwayMessage: string | null
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
