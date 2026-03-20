import type { SASLMechanism } from './irc'

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
