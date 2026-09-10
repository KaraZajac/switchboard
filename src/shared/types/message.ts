/** Message types */
export type MessageType = 'privmsg' | 'notice' | 'action' | 'system' | 'tagmsg' | 'motd'

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
  /** Channel context for PMs (draft/channel-context) */
  channelContext: string | null
  /** Message has been deleted/redacted */
  deleted?: boolean
  /** Timestamp when message was last edited */
  editedAt?: string
  /**
   * The operator name from a `draft/oper` tag, when the server said the sender
   * is one of its operators. Worth showing: someone claiming to be staff in a
   * DM is a common enough trick that being able to tell is the point of the
   * capability — and this is the server saying it, not a nick.
   */
  oper?: string | null
  /**
   * The bot that carried this, from a `draft/relaymsg` tag, when the message
   * came through a bridge. The nick is the person who wrote it — that is what
   * the relay is for — and this says how it got here.
   */
  relayedBy?: string | null
}
