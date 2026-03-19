/** Channel state */
export interface ChannelState {
  name: string
  serverId: string
  topic: string | null
  topicSetBy: string | null
  topicSetAt: string | null
  modes: Record<string, string | true>
  joined: boolean
  users: Map<string, ChannelUser>
  unreadCount: number
  mentionCount: number
  muted: boolean
  category: string | null
}

/** A user within a channel */
export interface ChannelUser {
  nick: string
  user: string | null
  host: string | null
  account: string | null
  realname: string | null
  prefixes: string[]
  away: boolean
  awayMessage: string | null
  isBot: boolean
}

/** User prefix ranks ordered highest to lowest */
export const PREFIX_RANKS: Record<string, number> = {
  '~': 5, // Owner
  '&': 4, // Admin
  '@': 3, // Op
  '%': 2, // Halfop
  '+': 1  // Voice
}
