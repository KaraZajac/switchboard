import { create } from 'zustand'

interface ChannelInfo {
  name: string
  serverId: string
  topic: string | null
  topicSetBy: string | null
  unreadCount: number
  mentionCount: number
  muted: boolean
  /** Timestamp when mute expires (0 = permanent until manually unmuted) */
  muteUntil: number
}

interface ChannelState {
  /** Channels per server: serverId -> channel[] */
  channels: Record<string, ChannelInfo[]>
  /** Currently active channel per server: serverId -> channelName */
  activeChannel: Record<string, string>
  /** Read marker timestamps: `serverId:channel` -> ISO timestamp */
  readMarkers: Record<string, string>

  // Actions
  addChannel: (serverId: string, name: string) => void
  removeChannel: (serverId: string, name: string) => void
  setActiveChannel: (serverId: string, name: string) => void
  setTopic: (serverId: string, name: string, topic: string, setBy: string | null) => void
  incrementUnread: (serverId: string, name: string, mention?: boolean) => void
  clearUnread: (serverId: string, name: string) => void
  toggleMute: (serverId: string, name: string, durationMs?: number) => void
  renameChannel: (serverId: string, oldName: string, newName: string) => void
  setReadMarker: (serverId: string, channel: string, timestamp: string) => void
  setReadMarkers: (serverId: string, markers: Record<string, string>) => void
  clearServerChannels: (serverId: string) => void
}

export const useChannelStore = create<ChannelState>((set) => ({
  channels: {},
  activeChannel: {},
  readMarkers: {},

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
              muted: false,
              muteUntil: 0
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
        [serverId]: (state.channels[serverId] || []).map((ch) => {
          if (ch.name.toLowerCase() !== name.toLowerCase()) return ch
          // Check if timed mute has expired
          const isMuted = ch.muted && (ch.muteUntil === 0 || ch.muteUntil > Date.now())
          if (isMuted) return ch
          // Auto-unmute if time has passed
          const updates: Partial<typeof ch> = ch.muted && ch.muteUntil > 0 && ch.muteUntil <= Date.now()
            ? { muted: false, muteUntil: 0 }
            : {}
          return {
            ...ch,
            ...updates,
            unreadCount: ch.unreadCount + 1,
            mentionCount: mention ? ch.mentionCount + 1 : ch.mentionCount
          }
        })
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

  renameChannel: (serverId, oldName, newName) =>
    set((state) => {
      const channels = (state.channels[serverId] || []).map((ch) =>
        ch.name.toLowerCase() === oldName.toLowerCase()
          ? { ...ch, name: newName }
          : ch
      )
      const active = state.activeChannel[serverId]
      return {
        channels: { ...state.channels, [serverId]: channels },
        activeChannel: {
          ...state.activeChannel,
          [serverId]: active?.toLowerCase() === oldName.toLowerCase() ? newName : active || ''
        }
      }
    }),

  setReadMarker: (serverId, channel, timestamp) =>
    set((state) => ({
      readMarkers: { ...state.readMarkers, [`${serverId}:${channel.toLowerCase()}`]: timestamp }
    })),

  setReadMarkers: (serverId, markers) =>
    set((state) => {
      const updated = { ...state.readMarkers }
      for (const [channel, timestamp] of Object.entries(markers)) {
        updated[`${serverId}:${channel.toLowerCase()}`] = timestamp
      }
      return { readMarkers: updated }
    }),

  toggleMute: (serverId, name, durationMs) =>
    set((state) => ({
      channels: {
        ...state.channels,
        [serverId]: (state.channels[serverId] || []).map((ch) => {
          if (ch.name.toLowerCase() !== name.toLowerCase()) return ch
          if (ch.muted) {
            // Unmute
            return { ...ch, muted: false, muteUntil: 0 }
          }
          // Mute with optional duration
          return {
            ...ch,
            muted: true,
            muteUntil: durationMs ? Date.now() + durationMs : 0
          }
        })
      }
    })),

  clearServerChannels: (serverId) =>
    set((state) => ({
      channels: { ...state.channels, [serverId]: [] }
    }))
}))
