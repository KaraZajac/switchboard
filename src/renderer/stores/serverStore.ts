import { create } from 'zustand'
import type { UserMetadata } from '@shared/types/metadata'
import type { ServerConfig } from '@shared/types/server'

interface ServerState {
  /** All configured servers */
  servers: ServerConfig[]
  /** Currently active (selected) server ID */
  activeServerId: string | null
  /** Connection status per server */
  connectionStatus: Record<string, 'disconnected' | 'connecting' | 'connected'>
  /** Server capabilities */
  capabilities: Record<string, string[]>
  /** Our current nick per server */
  currentNick: Record<string, string>
  /** User avatars from metadata: `${serverId}:${nick}` -> URL */
  /** Everyone's draft/metadata-2 profile: `serverId:nick` -> keys */
  userMetadata: Record<string, UserMetadata>
  /** Muted servers: serverId -> muteUntil timestamp (0 = permanent) */
  mutedServers: Record<string, number>
  /** Network icons from ISUPPORT draft/ICON: serverId -> URL */
  networkIcons: Record<string, string>
  /** Filehost URLs from ISUPPORT draft/FILEHOST: serverId -> URL */
  filehostUrls: Record<string, string>
  /** Away status per server: serverId -> away message (null = not away) */
  awayMessage: Record<string, string | null>

  // Actions
  setServers: (servers: ServerConfig[]) => void
  addServer: (server: ServerConfig) => void
  updateServer: (id: string, updates: Partial<ServerConfig>) => void
  removeServer: (id: string) => void
  setActiveServer: (id: string | null) => void
  setConnectionStatus: (id: string, status: 'disconnected' | 'connecting' | 'connected') => void
  setCapabilities: (id: string, caps: string[]) => void
  setCurrentNick: (id: string, nick: string) => void
  setUserMetadata: (serverId: string, nick: string, key: string, value: string) => void
  setNetworkIcon: (serverId: string, url: string) => void
  setFilehostUrl: (serverId: string, url: string) => void
  setAwayMessage: (serverId: string, message: string | null) => void
  muteServer: (serverId: string, durationMs?: number) => void
  unmuteServer: (serverId: string) => void
  /** Apply saved server mutes at startup */
  setMutedServers: (muted: Record<string, number>) => void
  isServerMuted: (serverId: string) => boolean
}

export const useServerStore = create<ServerState>((set, get) => ({
  servers: [],
  activeServerId: null,
  connectionStatus: {},
  capabilities: {},
  currentNick: {},
  userMetadata: {},
  mutedServers: {},
  networkIcons: {},
  filehostUrls: {},
  awayMessage: {},

  setServers: (servers) => set({ servers }),

  addServer: (server) =>
    set((state) => ({
      servers: [...state.servers, server],
      activeServerId: state.activeServerId || server.id
    })),

  updateServer: (id, updates) =>
    set((state) => ({
      servers: state.servers.map((s) => (s.id === id ? { ...s, ...updates } : s))
    })),

  removeServer: (id) =>
    set((state) => ({
      servers: state.servers.filter((s) => s.id !== id),
      activeServerId: state.activeServerId === id
        ? state.servers.find((s) => s.id !== id)?.id || null
        : state.activeServerId
    })),

  setActiveServer: (id) => set({ activeServerId: id }),

  setConnectionStatus: (id, status) =>
    set((state) => ({
      connectionStatus: { ...state.connectionStatus, [id]: status }
    })),

  setCapabilities: (id, caps) =>
    set((state) => ({
      capabilities: { ...state.capabilities, [id]: caps }
    })),

  setCurrentNick: (id, nick) =>
    set((state) => ({
      currentNick: { ...state.currentNick, [id]: nick }
    })),

  setUserMetadata: (serverId, nick, key, value) =>
    set((state) => {
      const mapKey = `${serverId}:${nick.toLowerCase()}`
      const current = state.userMetadata[mapKey] ?? {}
      const next = { ...current }

      // An empty value is how the server says a key was cleared
      if (value === '') {
        delete next[key as keyof UserMetadata]
      } else {
        next[key as keyof UserMetadata] = value
      }

      return { userMetadata: { ...state.userMetadata, [mapKey]: next } }
    }),

  setNetworkIcon: (serverId, url) =>
    set((state) => ({
      networkIcons: { ...state.networkIcons, [serverId]: url }
    })),

  setFilehostUrl: (serverId, url) =>
    set((state) => ({
      filehostUrls: { ...state.filehostUrls, [serverId]: url }
    })),

  setAwayMessage: (serverId, message) =>
    set((state) => ({
      awayMessage: { ...state.awayMessage, [serverId]: message }
    })),

  muteServer: (serverId, durationMs) =>
    set((state) => ({
      mutedServers: {
        ...state.mutedServers,
        [serverId]: durationMs ? Date.now() + durationMs : 0
      }
    })),

  setMutedServers: (muted) => set({ mutedServers: muted }),

  unmuteServer: (serverId) =>
    set((state) => {
      const updated = { ...state.mutedServers }
      delete updated[serverId]
      return { mutedServers: updated }
    }),

  isServerMuted: (serverId) => {
    const muteUntil = get().mutedServers[serverId]
    if (muteUntil === undefined) return false
    if (muteUntil === 0) return true // permanent
    return muteUntil > Date.now()
  }
}))
