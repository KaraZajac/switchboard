import { useEffect } from 'react'
import { useServerStore } from '../stores/serverStore'
import { useChannelStore } from '../stores/channelStore'
import { useMessageStore } from '../stores/messageStore'
import { useUserStore } from '../stores/userStore'

/**
 * Hook that sets up all IPC event listeners from the main process.
 * Should be called once at the app root.
 *
 * Uses getState() to access store actions to avoid subscribing to
 * the stores (which would cause infinite re-render loops).
 */
export function useIRCEvents(): void {
  useEffect(() => {
    const api = window.switchboard
    if (!api) return

    const cleanups: (() => void)[] = []

    // Connection events
    cleanups.push(
      api.on('irc:connected', ({ serverId }) => {
        useServerStore.getState().setConnectionStatus(serverId, 'connected')
      })
    )

    cleanups.push(
      api.on('irc:disconnected', ({ serverId }) => {
        useServerStore.getState().setConnectionStatus(serverId, 'disconnected')
      })
    )

    cleanups.push(
      api.on('irc:cap', ({ serverId, capabilities }) => {
        useServerStore.getState().setCapabilities(serverId, capabilities)
      })
    )

    // Channel events
    cleanups.push(
      api.on('irc:join', ({ serverId, channel, user }) => {
        useChannelStore.getState().addChannel(serverId, channel)
        useUserStore.getState().addUser(serverId, channel, user)
      })
    )

    cleanups.push(
      api.on('irc:part', ({ serverId, channel, nick }) => {
        useUserStore.getState().removeUser(serverId, channel, nick)
      })
    )

    cleanups.push(
      api.on('irc:kick', ({ serverId, channel, nick }) => {
        useUserStore.getState().removeUser(serverId, channel, nick)
      })
    )

    cleanups.push(
      api.on('irc:topic', ({ serverId, channel, topic, setBy }) => {
        useChannelStore.getState().setTopic(serverId, channel, topic, setBy)
      })
    )

    cleanups.push(
      api.on('irc:names', ({ serverId, channel, users }) => {
        useUserStore.getState().setUsers(serverId, channel, users)
      })
    )

    // Message events
    cleanups.push(
      api.on('irc:message', ({ serverId, channel, message }) => {
        useMessageStore.getState().addMessage(serverId, channel, message)

        // Check if this channel is currently active
        const activeServerId = useServerStore.getState().activeServerId
        const activeChannel = useChannelStore.getState().activeChannel[serverId]
        if (serverId !== activeServerId || channel !== activeChannel) {
          const currentNick = ''
          const isMention = message.content.toLowerCase().includes(currentNick.toLowerCase())
          useChannelStore.getState().incrementUnread(serverId, channel, isMention)
        }
      })
    )

    // User events
    cleanups.push(
      api.on('irc:nick', ({ serverId, oldNick, newNick }) => {
        useUserStore.getState().renameUser(serverId, oldNick, newNick)
      })
    )

    cleanups.push(
      api.on('irc:quit', ({ serverId, nick }) => {
        useUserStore.getState().removeUserFromServer(serverId, nick)
      })
    )

    cleanups.push(
      api.on('irc:typing', ({ serverId, channel, nick, status }) => {
        useMessageStore.getState().setTyping(serverId, channel, nick, status === 'active' || status === 'paused')
      })
    )

    cleanups.push(
      api.on('irc:react', ({ serverId, channel, nick, msgid, emoji }) => {
        useMessageStore.getState().addReaction(serverId, channel, msgid, nick, emoji)
      })
    )

    cleanups.push(
      api.on('irc:redact', ({ serverId, channel, msgid }) => {
        useMessageStore.getState().removeMessage(serverId, channel, msgid)
      })
    )

    return () => {
      for (const cleanup of cleanups) {
        cleanup()
      }
    }
  }, [])
}
