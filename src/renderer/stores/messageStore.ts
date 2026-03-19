import { create } from 'zustand'
import type { ChatMessage } from '@shared/types/message'

interface MessageState {
  /** Messages per channel: `${serverId}:${channel}` -> messages */
  messages: Record<string, ChatMessage[]>
  /** Typing indicators: `${serverId}:${channel}` -> nick[] */
  typing: Record<string, string[]>

  // Actions
  addMessage: (serverId: string, channel: string, message: ChatMessage) => void
  setMessages: (serverId: string, channel: string, messages: ChatMessage[]) => void
  prependMessages: (serverId: string, channel: string, messages: ChatMessage[]) => void
  addReaction: (serverId: string, channel: string, msgid: string, nick: string, emoji: string) => void
  removeMessage: (serverId: string, channel: string, msgid: string) => void
  setTyping: (serverId: string, channel: string, nick: string, active: boolean) => void
  clearTyping: (serverId: string, channel: string) => void
}

function channelKey(serverId: string, channel: string): string {
  return `${serverId}:${channel}`
}

export const useMessageStore = create<MessageState>((set) => ({
  messages: {},
  typing: {},

  addMessage: (serverId, channel, message) =>
    set((state) => {
      const key = channelKey(serverId, channel)
      const existing = state.messages[key] || []
      // Avoid duplicates by msgid
      if (message.id && existing.some((m) => m.id === message.id)) {
        return state
      }
      return {
        messages: {
          ...state.messages,
          [key]: [...existing, message]
        }
      }
    }),

  setMessages: (serverId, channel, messages) =>
    set((state) => ({
      messages: {
        ...state.messages,
        [channelKey(serverId, channel)]: messages
      }
    })),

  prependMessages: (serverId, channel, messages) =>
    set((state) => {
      const key = channelKey(serverId, channel)
      const existing = state.messages[key] || []
      return {
        messages: {
          ...state.messages,
          [key]: [...messages, ...existing]
        }
      }
    }),

  addReaction: (serverId, channel, msgid, nick, emoji) =>
    set((state) => {
      const key = channelKey(serverId, channel)
      const messages = (state.messages[key] || []).map((m) => {
        if (m.id !== msgid) return m
        const reactions = { ...m.reactions }
        if (!reactions[emoji]) {
          reactions[emoji] = [nick]
        } else if (!reactions[emoji].includes(nick)) {
          reactions[emoji] = [...reactions[emoji], nick]
        }
        return { ...m, reactions }
      })
      return { messages: { ...state.messages, [key]: messages } }
    }),

  removeMessage: (serverId, channel, msgid) =>
    set((state) => {
      const key = channelKey(serverId, channel)
      return {
        messages: {
          ...state.messages,
          [key]: (state.messages[key] || []).filter((m) => m.id !== msgid)
        }
      }
    }),

  setTyping: (serverId, channel, nick, active) =>
    set((state) => {
      const key = channelKey(serverId, channel)
      const current = state.typing[key] || []
      const without = current.filter((n) => n.toLowerCase() !== nick.toLowerCase())
      return {
        typing: {
          ...state.typing,
          [key]: active ? [...without, nick] : without
        }
      }
    }),

  clearTyping: (serverId, channel) =>
    set((state) => ({
      typing: { ...state.typing, [channelKey(serverId, channel)]: [] }
    }))
}))
