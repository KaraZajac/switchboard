import { create } from 'zustand'
import type { ChatMessage } from '@shared/types/message'

export interface ReplyTarget {
  id: string
  nick: string
  content: string
}

interface MessageState {
  /** Messages per channel: `${serverId}:${channel}` -> messages */
  messages: Record<string, ChatMessage[]>
  /** Typing indicators: `${serverId}:${channel}` -> nick[] */
  typing: Record<string, string[]>
  /** Active reply target per channel */
  replyTarget: Record<string, ReplyTarget | null>

  // Actions
  addMessage: (serverId: string, channel: string, message: ChatMessage) => void
  setMessages: (serverId: string, channel: string, messages: ChatMessage[]) => void
  prependMessages: (serverId: string, channel: string, messages: ChatMessage[]) => void
  setReaction: (
    serverId: string,
    channel: string,
    msgid: string,
    nick: string,
    emoji: string,
    present: boolean
  ) => void
  removeMessage: (serverId: string, channel: string, msgid: string) => void
  editMessage: (serverId: string, channel: string, msgid: string, newContent: string, editedAt: string) => void
  setTyping: (serverId: string, channel: string, nick: string, active: boolean) => void
  clearTyping: (serverId: string, channel: string) => void
  setReplyTarget: (serverId: string, channel: string, target: ReplyTarget | null) => void
  getMessageById: (serverId: string, channel: string, msgid: string) => ChatMessage | undefined
}

function channelKey(serverId: string, channel: string): string {
  return `${serverId}:${channel.toLowerCase()}`
}

/**
 * How many messages one conversation keeps in memory.
 *
 * Nothing trimmed this at all: a channel left open for a week grew until the
 * window did. What is on screen is what the person can scroll to in a sitting,
 * and everything older is in the database — `history:fetch` and
 * `chathistory:request` are how it comes back, which is what scrolling up
 * already does.
 *
 * Generous on purpose. The point is a ceiling, not a small one.
 */
export const SCROLLBACK_LIMIT = 2000

/** Keep the newest [SCROLLBACK_LIMIT], dropping the oldest */
function capped(messages: ChatMessage[]): ChatMessage[] {
  if (messages.length <= SCROLLBACK_LIMIT) return messages
  return messages.slice(messages.length - SCROLLBACK_LIMIT)
}

export const useMessageStore = create<MessageState>((set, get) => ({
  messages: {},
  typing: {},
  replyTarget: {},

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
          [key]: capped([...existing, message])
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
          // The same ceiling from the other end: scrolling far enough back
          // drops the newest, which is still in the database and one scroll
          // the other way from coming back.
          [key]: [...messages, ...existing].slice(0, SCROLLBACK_LIMIT)
        }
      }
    }),

  /**
   * Add or take back one person's reaction.
   *
   * Both directions in one place: an unreact is the same event with a flag, and
   * splitting them into two actions is how one of the two ends up unhandled.
   */
  setReaction: (serverId, channel, msgid, nick, emoji, present) =>
    set((state) => {
      const key = channelKey(serverId, channel)
      const messages = (state.messages[key] || []).map((m) => {
        if (m.id !== msgid) return m

        const people = new Set(m.reactions[emoji] ?? [])
        if (present) people.add(nick)
        else people.delete(nick)

        const reactions = { ...m.reactions }
        if (people.size === 0) delete reactions[emoji]
        else reactions[emoji] = [...people]

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
          [key]: (state.messages[key] || []).map((m) =>
            m.id === msgid ? { ...m, deleted: true, content: '' } : m
          )
        }
      }
    }),

  editMessage: (serverId, channel, msgid, newContent, editedAt) =>
    set((state) => {
      const key = channelKey(serverId, channel)
      return {
        messages: {
          ...state.messages,
          [key]: (state.messages[key] || []).map((m) =>
            m.id === msgid ? { ...m, content: newContent, editedAt } : m
          )
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
    })),

  setReplyTarget: (serverId, channel, target) =>
    set((state) => ({
      replyTarget: { ...state.replyTarget, [channelKey(serverId, channel)]: target }
    })),

  getMessageById: (serverId, channel, msgid) => {
    const key = channelKey(serverId, channel)
    return (get().messages[key] || []).find((m) => m.id === msgid)
  }
}))
