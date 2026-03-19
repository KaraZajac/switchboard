/**
 * Core IRC message types following IRCv3 spec.
 */

/** A parsed IRC message with full IRCv3 tag support */
export interface IRCMessage {
  /** Message tags (IRCv3 message-tags) */
  tags: Record<string, string | true>
  /** Source prefix (nick!user@host or server name) */
  prefix: string | null
  /** Parsed prefix components */
  source: IRCSource | null
  /** IRC command (e.g., PRIVMSG, 001, JOIN) */
  command: string
  /** Command parameters */
  params: string[]
}

export interface IRCSource {
  nick: string
  user: string | null
  host: string | null
}

/** IRC capability negotiation state */
export type CapState = 'negotiating' | 'done'

/** SASL mechanism types */
export type SASLMechanism = 'PLAIN' | 'EXTERNAL' | 'SCRAM-SHA-256'

/** SASL authentication state */
export type SASLState = 'idle' | 'authenticating' | 'success' | 'failed'

/** Connection registration state */
export type RegistrationState = 'disconnected' | 'connecting' | 'registering' | 'connected'

/** Batch tracking */
export interface IRCBatch {
  id: string
  type: string
  params: string[]
  messages: IRCMessage[]
  parent: string | null
}
