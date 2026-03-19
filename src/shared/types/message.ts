/** Message types */
export type MessageType = 'privmsg' | 'notice' | 'action' | 'system' | 'tagmsg'

/** A chat message */
export interface ChatMessage {
  id: string
  serverId: string
  channel: string
  nick: string
  userHost: string | null
  content: string
  type: MessageType
  tags: Record<string, string>
  replyTo: string | null
  timestamp: string
  account: string | null
  /** Pending = sent by us, not yet echoed back */
  pending: boolean
  /** Reactions grouped by emoji */
  reactions: Record<string, string[]>
}
