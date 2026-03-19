import { create } from 'zustand'

interface ChannelInfo {
  name: string
  serverId: string
  topic: string | null
  topicSetBy: string | null
  unreadCount: number
  mentionCount: number
  muted: boolean
}

interface ChannelState {
  /** Channels per server: serverId -> channel[] */
  channels: Record<string, ChannelInfo[]>
  /** Currently active channel per server: serverId -> channelName */
  activeChannel: Record<string, string>

  // Actions
  addChannel: (serverId: string, name: string) => void
  removeChannel: (serverId: string, name: string) => void
  setActiveChannel: (serverId: string, name: string) => void
  setTopic: (serverId: string, name: string, topic: string, setBy: string | null) => void
  incrementUnread: (serverId: string, name: string, mention?: boolean) => void
  clearUnread: (serverId: string, name: string) => void
  clearServerChannels: (serverId: string) => void
}

export const useChannelStore = create<ChannelState>((set) => ({
  channels: {},
  activeChannel: {},

  addChannel: (serverId, name) =>
    set((state) => {
      const existing = state.channels[serverId] || []
      if (existing.some((ch) => ch.name.toLowerCase() === name.toLowerCase())) {
        return state
      }
      return {
        channels: {
          ...state.channels,
          [serverId]: [
            ...existing,
            {
              name,
              serverId,
              topic: null,
              topicSetBy: null,
              unreadCount: 0,
              mentionCount: 0,
              muted: false
            }
          ]
        },
        activeChannel: {
          ...state.activeChannel,
          [serverId]: state.activeChannel[serverId] || name
        }
      }
    }),

  removeChannel: (serverId, name) =>
    set((state) => {
      const channels = (state.channels[serverId] || []).filter(
        (ch) => ch.name.toLowerCase() !== name.toLowerCase()
      )
      const active = state.activeChannel[serverId]
      return {
        channels: { ...state.channels, [serverId]: channels },
        activeChannel: {
          ...state.activeChannel,
          [serverId]:
            active?.toLowerCase() === name.toLowerCase()
              ? channels[0]?.name || ''
              : active || ''
        }
      }
    }),

  setActiveChannel: (serverId, name) =>
    set((state) => ({
      activeChannel: { ...state.activeChannel, [serverId]: name }
    })),

  setTopic: (serverId, name, topic, setBy) =>
    set((state) => ({
      channels: {
        ...state.channels,
        [serverId]: (state.channels[serverId] || []).map((ch) =>
          ch.name.toLowerCase() === name.toLowerCase()
            ? { ...ch, topic, topicSetBy: setBy }
            : ch
        )
      }
    })),

  incrementUnread: (serverId, name, mention = false) =>
    set((state) => ({
      channels: {
        ...state.channels,
        [serverId]: (state.channels[serverId] || []).map((ch) =>
          ch.name.toLowerCase() === name.toLowerCase()
            ? {
                ...ch,
                unreadCount: ch.unreadCount + 1,
                mentionCount: mention ? ch.mentionCount + 1 : ch.mentionCount
              }
            : ch
        )
      }
    })),

  clearUnread: (serverId, name) =>
    set((state) => ({
      channels: {
        ...state.channels,
        [serverId]: (state.channels[serverId] || []).map((ch) =>
          ch.name.toLowerCase() === name.toLowerCase()
            ? { ...ch, unreadCount: 0, mentionCount: 0 }
            : ch
        )
      }
    })),

  clearServerChannels: (serverId) =>
    set((state) => ({
      channels: { ...state.channels, [serverId]: [] }
    }))
}))
