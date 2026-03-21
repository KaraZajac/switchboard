import { create } from 'zustand'
import type { ChannelUser } from '@shared/types/channel'

export interface MonitoredNick {
  nick: string
  online: boolean
}

interface UserState {
  /** Users per channel: `${serverId}:${channel}` -> users */
  users: Record<string, ChannelUser[]>
  /** Monitored nicks per server: serverId -> nicks */
  monitoredNicks: Record<string, MonitoredNick[]>

  // Actions
  setUsers: (serverId: string, channel: string, users: ChannelUser[]) => void
  addUser: (serverId: string, channel: string, user: ChannelUser) => void
  removeUser: (serverId: string, channel: string, nick: string) => void
  updateUser: (serverId: string, channel: string, nick: string, updates: Partial<ChannelUser>) => void
  renameUser: (serverId: string, oldNick: string, newNick: string) => void
  removeUserFromServer: (serverId: string, nick: string) => void
  setMonitorList: (serverId: string, nicks: string[]) => void
  setMonitorOnline: (serverId: string, nick: string) => void
  setMonitorOffline: (serverId: string, nick: string) => void
  addMonitorNick: (serverId: string, nick: string) => void
  removeMonitorNick: (serverId: string, nick: string) => void
}

function channelKey(serverId: string, channel: string): string {
  return `${serverId}:${channel.toLowerCase()}`
}

export const useUserStore = create<UserState>((set) => ({
  users: {},

  setUsers: (serverId, channel, users) =>
    set((state) => ({
      users: { ...state.users, [channelKey(serverId, channel)]: users }
    })),

  addUser: (serverId, channel, user) =>
    set((state) => {
      const key = channelKey(serverId, channel)
      const existing = state.users[key] || []
      if (existing.some((u) => u.nick.toLowerCase() === user.nick.toLowerCase())) {
        return state
      }
      return { users: { ...state.users, [key]: [...existing, user] } }
    }),

  removeUser: (serverId, channel, nick) =>
    set((state) => {
      const key = channelKey(serverId, channel)
      return {
        users: {
          ...state.users,
          [key]: (state.users[key] || []).filter(
            (u) => u.nick.toLowerCase() !== nick.toLowerCase()
          )
        }
      }
    }),

  updateUser: (serverId, channel, nick, updates) =>
    set((state) => {
      const key = channelKey(serverId, channel)
      return {
        users: {
          ...state.users,
          [key]: (state.users[key] || []).map((u) =>
            u.nick.toLowerCase() === nick.toLowerCase() ? { ...u, ...updates } : u
          )
        }
      }
    }),

  renameUser: (serverId, oldNick, newNick) =>
    set((state) => {
      const updated: Record<string, ChannelUser[]> = {}
      for (const [key, users] of Object.entries(state.users)) {
        if (!key.startsWith(serverId + ':')) {
          updated[key] = users
          continue
        }
        updated[key] = users.map((u) =>
          u.nick.toLowerCase() === oldNick.toLowerCase() ? { ...u, nick: newNick } : u
        )
      }
      return { users: updated }
    }),

  removeUserFromServer: (serverId, nick) =>
    set((state) => {
      const updated: Record<string, ChannelUser[]> = {}
      for (const [key, users] of Object.entries(state.users)) {
        if (!key.startsWith(serverId + ':')) {
          updated[key] = users
          continue
        }
        updated[key] = users.filter((u) => u.nick.toLowerCase() !== nick.toLowerCase())
      }
      return { users: updated }
    }),

  monitoredNicks: {},

  setMonitorList: (serverId, nicks) =>
    set((state) => ({
      monitoredNicks: {
        ...state.monitoredNicks,
        [serverId]: nicks.map((nick) => {
          const existing = (state.monitoredNicks[serverId] || []).find(
            (m) => m.nick.toLowerCase() === nick.toLowerCase()
          )
          return existing || { nick, online: false }
        })
      }
    })),

  setMonitorOnline: (serverId, nick) =>
    set((state) => {
      const list = state.monitoredNicks[serverId] || []
      const exists = list.some((m) => m.nick.toLowerCase() === nick.toLowerCase())
      const updated = exists
        ? list.map((m) => m.nick.toLowerCase() === nick.toLowerCase() ? { ...m, online: true } : m)
        : [...list, { nick, online: true }]
      return { monitoredNicks: { ...state.monitoredNicks, [serverId]: updated } }
    }),

  setMonitorOffline: (serverId, nick) =>
    set((state) => {
      const list = state.monitoredNicks[serverId] || []
      const exists = list.some((m) => m.nick.toLowerCase() === nick.toLowerCase())
      const updated = exists
        ? list.map((m) => m.nick.toLowerCase() === nick.toLowerCase() ? { ...m, online: false } : m)
        : [...list, { nick, online: false }]
      return { monitoredNicks: { ...state.monitoredNicks, [serverId]: updated } }
    }),

  addMonitorNick: (serverId, nick) =>
    set((state) => {
      const list = state.monitoredNicks[serverId] || []
      if (list.some((m) => m.nick.toLowerCase() === nick.toLowerCase())) return state
      return {
        monitoredNicks: {
          ...state.monitoredNicks,
          [serverId]: [...list, { nick, online: false }]
        }
      }
    }),

  removeMonitorNick: (serverId, nick) =>
    set((state) => ({
      monitoredNicks: {
        ...state.monitoredNicks,
        [serverId]: (state.monitoredNicks[serverId] || []).filter(
          (m) => m.nick.toLowerCase() !== nick.toLowerCase()
        )
      }
    }))
}))
