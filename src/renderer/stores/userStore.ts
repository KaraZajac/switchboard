import { create } from 'zustand'
import type { ChannelUser } from '@shared/types/channel'

interface UserState {
  /** Users per channel: `${serverId}:${channel}` -> users */
  users: Record<string, ChannelUser[]>

  // Actions
  setUsers: (serverId: string, channel: string, users: ChannelUser[]) => void
  addUser: (serverId: string, channel: string, user: ChannelUser) => void
  removeUser: (serverId: string, channel: string, nick: string) => void
  updateUser: (serverId: string, channel: string, nick: string, updates: Partial<ChannelUser>) => void
  renameUser: (serverId: string, oldNick: string, newNick: string) => void
  removeUserFromServer: (serverId: string, nick: string) => void
}

function channelKey(serverId: string, channel: string): string {
  return `${serverId}:${channel}`
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
    })
}))
