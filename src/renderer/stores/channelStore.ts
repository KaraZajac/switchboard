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

/** Key for the mute map: server + lowercased channel name */
const muteKey = (serverId: string, name: string): string => `${serverId}:${name.toLowerCase()}`

/** A stored mute counts only until it expires (0 means "until manually unmuted") */
const isMuteActive = (muteUntil: number | undefined): boolean =>
  muteUntil !== undefined && (muteUntil === 0 || muteUntil > Date.now())

interface ChannelState {
  /** Channels per server: serverId -> channel[] */
  channels: Record<string, ChannelInfo[]>
  /** Muted channels: `serverId:channel` -> expiry timestamp (0 = permanent) */
  mutedChannels: Record<string, number>
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
  /** Apply saved mutes at startup, before any channel has been joined */
  hydrateMutes: (muted: Record<string, number>) => void
  renameChannel: (serverId: string, oldName: string, newName: string) => void
  setReadMarker: (serverId: string, channel: string, timestamp: string) => void
  setReadMarkers: (serverId: string, markers: Record<string, string>) => void
  clearServerChannels: (serverId: string) => void
}

export const useChannelStore = create<ChannelState>((set) => ({
  channels: {},
  mutedChannels: {},
  activeChannel: {},
  readMarkers: {},

  addChannel: (serverId, name) =>
    set((state) => {
      const existing = state.channels[serverId] || []
      if (existing.some((ch) => ch.name.toLowerCase() === name.toLowerCase())) {
        return state
      }
      // A channel muted in an earlier session comes back muted
      const savedMute = state.mutedChannels[muteKey(serverId, name)]
      const stillMuted = isMuteActive(savedMute)
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
              muted: stillMuted,
              muteUntil: stillMuted ? (savedMute as number) : 0
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
    set((state) => {
      const updated = {
        ...state.channels,
        [serverId]: (state.channels[serverId] || []).map((ch) =>
          ch.name.toLowerCase() === name.toLowerCase()
            ? { ...ch, unreadCount: 0, mentionCount: 0 }
            : ch
        )
      }
      // Recalculate and update dock badge
      let totalMentions = 0
      for (const chs of Object.values(updated)) {
        totalMentions += chs.reduce((sum, ch) => sum + ch.mentionCount, 0)
      }
      window.switchboard?.invoke('tray:set-badge', totalMentions)
      return { channels: updated }
    }),

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
    set((state) => {
      const key = muteKey(serverId, name)
      const wasMuted = isMuteActive(state.mutedChannels[key])
      const muteUntil = durationMs ? Date.now() + durationMs : 0

      const mutedChannels = { ...state.mutedChannels }
      if (wasMuted) {
        delete mutedChannels[key]
      } else {
        mutedChannels[key] = muteUntil
      }

      return {
        mutedChannels,
        channels: {
          ...state.channels,
          [serverId]: (state.channels[serverId] || []).map((ch) =>
            ch.name.toLowerCase() === name.toLowerCase()
              ? { ...ch, muted: !wasMuted, muteUntil: wasMuted ? 0 : muteUntil }
              : ch
          )
        }
      }
    }),

  hydrateMutes: (muted) =>
    set((state) => {
      // Drop mutes that ran out while the app was closed
      const active = Object.fromEntries(
        Object.entries(muted).filter(([, muteUntil]) => isMuteActive(muteUntil))
      )

      return {
        mutedChannels: active,
        channels: Object.fromEntries(
          Object.entries(state.channels).map(([serverId, channels]) => [
            serverId,
            channels.map((ch) => {
              const savedMute = active[muteKey(serverId, ch.name)]
              return {
                ...ch,
                muted: savedMute !== undefined,
                muteUntil: savedMute ?? 0
              }
            })
          ])
        )
      }
    }),

  clearServerChannels: (serverId) =>
    set((state) => ({
      channels: { ...state.channels, [serverId]: [] }
    }))
}))
