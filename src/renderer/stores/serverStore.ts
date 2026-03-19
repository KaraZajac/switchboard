import { create } from 'zustand'
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

  // Actions
  setServers: (servers: ServerConfig[]) => void
  addServer: (server: ServerConfig) => void
  updateServer: (id: string, updates: Partial<ServerConfig>) => void
  removeServer: (id: string) => void
  setActiveServer: (id: string | null) => void
  setConnectionStatus: (id: string, status: 'disconnected' | 'connecting' | 'connected') => void
  setCapabilities: (id: string, caps: string[]) => void
}

export const useServerStore = create<ServerState>((set) => ({
  servers: [],
  activeServerId: null,
  connectionStatus: {},
  capabilities: {},

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
    }))
}))
