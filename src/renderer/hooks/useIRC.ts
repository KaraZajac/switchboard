import { useEffect } from 'react'
import { useServerStore } from '../stores/serverStore'
import { useChannelStore } from '../stores/channelStore'
import { useMessageStore } from '../stores/messageStore'
import { useUserStore } from '../stores/userStore'

/**
 * Hook that sets up all IPC event listeners from the main process.
 * Should be called once at the app root.
 */
export function useIRCEvents(): void {
  const setConnectionStatus = useServerStore((s) => s.setConnectionStatus)
  const setCapabilities = useServerStore((s) => s.setCapabilities)
  const addChannel = useChannelStore((s) => s.addChannel)
  const removeChannel = useChannelStore((s) => s.removeChannel)
  const setTopic = useChannelStore((s) => s.setTopic)
  const incrementUnread = useChannelStore((s) => s.incrementUnread)
  const addMessage = useMessageStore((s) => s.addMessage)
  const addReaction = useMessageStore((s) => s.addReaction)
  const removeMessage = useMessageStore((s) => s.removeMessage)
  const setTyping = useMessageStore((s) => s.setTyping)
  const setUsers = useUserStore((s) => s.setUsers)
  const addUser = useUserStore((s) => s.addUser)
  const removeUser = useUserStore((s) => s.removeUser)
  const renameUser = useUserStore((s) => s.renameUser)
  const removeUserFromServer = useUserStore((s) => s.removeUserFromServer)

  useEffect(() => {
    const api = window.switchboard
    const cleanups: (() => void)[] = []

    // Connection events
    cleanups.push(
      api.on('irc:connected', ({ serverId }) => {
        setConnectionStatus(serverId, 'connected')
      })
    )

    cleanups.push(
      api.on('irc:disconnected', ({ serverId }) => {
        setConnectionStatus(serverId, 'disconnected')
      })
    )

    cleanups.push(
      api.on('irc:cap', ({ serverId, capabilities }) => {
        setCapabilities(serverId, capabilities)
      })
    )

    // Channel events
    cleanups.push(
      api.on('irc:join', ({ serverId, channel, user }) => {
        addChannel(serverId, channel)
        addUser(serverId, channel, user)
      })
    )

    cleanups.push(
      api.on('irc:part', ({ serverId, channel, nick }) => {
        removeUser(serverId, channel, nick)
      })
    )

    cleanups.push(
      api.on('irc:kick', ({ serverId, channel, nick }) => {
        removeUser(serverId, channel, nick)
      })
    )

    cleanups.push(
      api.on('irc:topic', ({ serverId, channel, topic, setBy }) => {
        setTopic(serverId, channel, topic, setBy)
      })
    )

    cleanups.push(
      api.on('irc:names', ({ serverId, channel, users }) => {
        setUsers(serverId, channel, users)
      })
    )

    // Message events
    cleanups.push(
      api.on('irc:message', ({ serverId, channel, message }) => {
        addMessage(serverId, channel, message)

        // Check if this channel is currently active
        const activeServerId = useServerStore.getState().activeServerId
        const activeChannel = useChannelStore.getState().activeChannel[serverId]
        if (serverId !== activeServerId || channel !== activeChannel) {
          // Check for mention
          const currentNick = '' // We'd need to track this
          const isMention = message.content.toLowerCase().includes(currentNick.toLowerCase())
          incrementUnread(serverId, channel, isMention)
        }
      })
    )

    // User events
    cleanups.push(
      api.on('irc:nick', ({ serverId, oldNick, newNick }) => {
        renameUser(serverId, oldNick, newNick)
      })
    )

    cleanups.push(
      api.on('irc:quit', ({ serverId, nick }) => {
        removeUserFromServer(serverId, nick)
      })
    )

    cleanups.push(
      api.on('irc:typing', ({ serverId, channel, nick, status }) => {
        setTyping(serverId, channel, nick, status === 'active' || status === 'paused')
      })
    )

    cleanups.push(
      api.on('irc:react', ({ serverId, channel, nick, msgid, emoji }) => {
        addReaction(serverId, channel, msgid, nick, emoji)
      })
    )

    cleanups.push(
      api.on('irc:redact', ({ serverId, channel, msgid }) => {
        removeMessage(serverId, channel, msgid)
      })
    )

    return () => {
      for (const cleanup of cleanups) {
        cleanup()
      }
    }
  }, [])
}
