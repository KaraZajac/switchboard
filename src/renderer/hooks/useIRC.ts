import { useEffect } from 'react'
import { useServerStore } from '../stores/serverStore'
import { useChannelStore } from '../stores/channelStore'
import { useMessageStore } from '../stores/messageStore'
import { useUserStore } from '../stores/userStore'
import { useUIStore } from '../stores/uiStore'
import { isChannelName } from '@shared/constants'

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
      api.on('irc:connected', ({ serverId, nick }) => {
        useServerStore.getState().setConnectionStatus(serverId, 'connected')
        if (nick) {
          useServerStore.getState().setCurrentNick(serverId, nick)
        }
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

        // Request our own avatar if metadata is supported
        if (capabilities.includes('draft/metadata-2')) {
          api.invoke('metadata:get', serverId, '*', 'avatar').catch(() => {})
        }
      })
    )

    // Channel events
    cleanups.push(
      api.on('irc:join', ({ serverId, channel, user }) => {
        useChannelStore.getState().addChannel(serverId, channel)
        useUserStore.getState().addUser(serverId, channel, user)

        // Load local history first, then request server history
        api.invoke('history:fetch', serverId, channel, undefined, 50).then((messages) => {
          if (messages && messages.length > 0) {
            useMessageStore.getState().setMessages(serverId, channel, messages)
          }
        })
        // Request server-side chathistory (results arrive via irc:chathistory)
        api.invoke('chathistory:request', serverId, channel, undefined, 50)
      })
    )

    // Chathistory batch response
    cleanups.push(
      api.on('irc:chathistory', ({ serverId, channel, messages }) => {
        if (messages.length > 0) {
          const store = useMessageStore.getState()
          const existing = store.messages[`${serverId}:${channel.toLowerCase()}`] || []
          // Merge: deduplicate by id, sort by timestamp
          const merged = [...existing]
          for (const msg of messages) {
            if (!merged.some((m) => m.id === msg.id)) {
              merged.push(msg)
            }
          }
          merged.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
          store.setMessages(serverId, channel, merged)
        }
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

    // Track our nick per server (local cache for mention detection)
    const currentNicks: Record<string, string> = {}

    cleanups.push(
      api.on('irc:connected', ({ serverId: sid, nick: connNick }) => {
        if (connNick) {
          currentNicks[sid] = connNick
        } else {
          const server = useServerStore.getState().servers.find((s) => s.id === sid)
          if (server) currentNicks[sid] = server.nick
        }
      })
    )

    // Message events
    cleanups.push(
      api.on('irc:message', ({ serverId, channel, message }) => {
        // Auto-create channel entry for incoming DMs (only for real messages, not server notices)
        if (!isChannelName(channel) && channel !== '*' && (message.type === 'privmsg' || message.type === 'action')) {
          useChannelStore.getState().addChannel(serverId, channel)
        }

        useMessageStore.getState().addMessage(serverId, channel, message)

        // Check if this channel is currently active
        const activeServerId = useServerStore.getState().activeServerId
        const activeChannel = useChannelStore.getState().activeChannel[serverId]
        const isActiveChannel = serverId === activeServerId && channel === activeChannel

        // Detect mentions
        const myNick = currentNicks[serverId] || ''
        const isMention = myNick
          ? new RegExp(`\\b${myNick.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(message.content)
          : false
        const isPrivate = !isChannelName(channel) && channel !== '*'

        if (!isActiveChannel) {
          useChannelStore.getState().incrementUnread(serverId, channel, isMention || isPrivate)
        }

        // Desktop notification for mentions and PMs (if enabled and not focused)
        if ((isMention || isPrivate) && !isActiveChannel) {
          const uiState = useUIStore.getState()
          if (uiState.notificationsEnabled) {
            const title = isPrivate
              ? `PM from ${message.nick}`
              : `${message.nick} in ${channel}`
            api.invoke('notification:send', title, message.content.slice(0, 200))
          }

          // Update tray badge
          const allChannels = useChannelStore.getState().channels
          let totalMentions = 0
          for (const chs of Object.values(allChannels)) {
            totalMentions += chs.reduce((sum, ch) => sum + ch.mentionCount, 0)
          }
          api.invoke('tray:set-badge', totalMentions + 1)
        }
      })
    )

    // User events
    cleanups.push(
      api.on('irc:nick', ({ serverId, oldNick, newNick }) => {
        useUserStore.getState().renameUser(serverId, oldNick, newNick)

        // If this is our own nick change, update the store
        if (currentNicks[serverId]?.toLowerCase() === oldNick.toLowerCase()) {
          currentNicks[serverId] = newNick
          useServerStore.getState().setCurrentNick(serverId, newNick)
        }
      })
    )

    cleanups.push(
      api.on('irc:quit', ({ serverId, nick }) => {
        useUserStore.getState().removeUserFromServer(serverId, nick)
      })
    )

    // Away status updates
    cleanups.push(
      api.on('irc:away', ({ serverId, nick, message }) => {
        const userStore = useUserStore.getState()
        // Update this user across all channels on this server
        for (const key of Object.keys(userStore.users)) {
          if (key.startsWith(serverId + ':')) {
            const channel = key.slice(serverId.length + 1)
            userStore.updateUser(serverId, channel, nick, {
              away: message !== null,
              awayMessage: message
            })
          }
        }
      })
    )

    // Account change notifications
    cleanups.push(
      api.on('irc:account', ({ serverId, nick, account }) => {
        const userStore = useUserStore.getState()
        for (const key of Object.keys(userStore.users)) {
          if (key.startsWith(serverId + ':')) {
            const channel = key.slice(serverId.length + 1)
            userStore.updateUser(serverId, channel, nick, { account })
          }
        }
      })
    )

    // Typing indicators with auto-clear timeout
    const typingTimers = new Map<string, ReturnType<typeof setTimeout>>()

    cleanups.push(
      api.on('irc:typing', ({ serverId, channel, nick, status }) => {
        const isTyping = status === 'active' || status === 'paused'
        useMessageStore.getState().setTyping(serverId, channel, nick, isTyping)

        // Clear any existing timer for this user
        const timerKey = `${serverId}:${channel}:${nick}`
        const existing = typingTimers.get(timerKey)
        if (existing) clearTimeout(existing)

        if (isTyping) {
          // Auto-clear after 6 seconds if no update
          typingTimers.set(timerKey, setTimeout(() => {
            useMessageStore.getState().setTyping(serverId, channel, nick, false)
            typingTimers.delete(timerKey)
          }, 6000))
        } else {
          typingTimers.delete(timerKey)
        }
      })
    )

    // Clean up typing timers on unmount
    cleanups.push(() => {
      for (const timer of typingTimers.values()) clearTimeout(timer)
      typingTimers.clear()
    })

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

    // Setname (realname change)
    cleanups.push(
      api.on('irc:setname', ({ serverId, nick, realname }) => {
        const userStore = useUserStore.getState()
        for (const key of Object.keys(userStore.users)) {
          if (key.startsWith(serverId + ':')) {
            const channel = key.slice(serverId.length + 1)
            userStore.updateUser(serverId, channel, nick, { realname })
          }
        }
      })
    )

    // Metadata updates (avatar, etc.)
    cleanups.push(
      api.on('irc:metadata', ({ serverId, target, key, value }) => {
        if (key === 'avatar') {
          useServerStore.getState().setUserAvatar(serverId, target, value)
        }
      })
    )

    // Channel rename
    cleanups.push(
      api.on('irc:channel-rename', ({ serverId, oldName, newName }) => {
        useChannelStore.getState().renameChannel(serverId, oldName, newName)
      })
    )

    // Read marker sync
    cleanups.push(
      api.on('irc:read-marker', ({ serverId, channel, timestamp }) => {
        useChannelStore.getState().setReadMarker(serverId, channel, timestamp)
      })
    )

    // On connect, load read markers from DB
    cleanups.push(
      api.on('irc:connected', ({ serverId: sid }) => {
        api.invoke('read-marker:get-all', sid).then((markers) => {
          if (markers && Object.keys(markers).length > 0) {
            useChannelStore.getState().setReadMarkers(sid, markers)
          }
        })
      })
    )

    // Netsplit/netjoin collapsed events
    cleanups.push(
      api.on('irc:netsplit', ({ serverId, server1, server2, nicks }) => {
        const content = nicks.length === 1
          ? `${nicks[0]} quit (netsplit: ${server1} \u2194 ${server2})`
          : `${nicks.length} users quit (netsplit: ${server1} \u2194 ${server2}): ${nicks.slice(0, 5).join(', ')}${nicks.length > 5 ? `, and ${nicks.length - 5} more` : ''}`

        // Get all channels for this server and add the system message to each
        const channels = useChannelStore.getState().channels[serverId] || []
        for (const ch of channels) {
          useMessageStore.getState().addMessage(serverId, ch.name, {
            id: `netsplit-${serverId}-${Date.now()}`,
            serverId,
            channel: ch.name,
            nick: '',
            userHost: null,
            content,
            type: 'system',
            tags: {},
            replyTo: null,
            timestamp: new Date().toISOString(),
            account: null,
            pending: false,
            reactions: {},
            channelContext: null
          })
        }

        // Remove users from all channels
        for (const nick of nicks) {
          useUserStore.getState().removeUserFromServer(serverId, nick)
        }
      })
    )

    cleanups.push(
      api.on('irc:netjoin', ({ serverId, server1, server2, nicks }) => {
        const content = nicks.length === 1
          ? `${nicks[0]} rejoined (netjoin: ${server1} \u2194 ${server2})`
          : `${nicks.length} users rejoined (netjoin: ${server1} \u2194 ${server2}): ${nicks.slice(0, 5).join(', ')}${nicks.length > 5 ? `, and ${nicks.length - 5} more` : ''}`

        const channels = useChannelStore.getState().channels[serverId] || []
        for (const ch of channels) {
          useMessageStore.getState().addMessage(serverId, ch.name, {
            id: `netjoin-${serverId}-${Date.now()}`,
            serverId,
            channel: ch.name,
            nick: '',
            userHost: null,
            content,
            type: 'system',
            tags: {},
            replyTo: null,
            timestamp: new Date().toISOString(),
            account: null,
            pending: false,
            reactions: {},
            channelContext: null
          })
        }
      })
    )

    // Menu events from app menu
    cleanups.push(
      api.on('menu:add-server', () => {
        useUIStore.getState().openModal('add-server')
      })
    )

    cleanups.push(
      api.on('menu:settings', () => {
        useUIStore.getState().openModal('settings')
      })
    )

    // WHOIS response
    cleanups.push(
      api.on('irc:whois', ({ serverId, data }) => {
        const whoisResult: import('../stores/uiStore').WhoisData = {
          nick: data.nick || '',
          user: data.user,
          host: data.host,
          realname: data.realname,
          server: data.server,
          serverInfo: data.serverInfo,
          account: data.account,
          channels: data.channels,
          idle: data.idle,
          signon: data.signon,
          isOperator: data.isOperator === 'true',
          isBot: data.isBot === 'true'
        }

        const uiState = useUIStore.getState()
        if (uiState.popupWhoisNick?.toLowerCase() === whoisResult.nick.toLowerCase()) {
          uiState.setPopupWhoisData(whoisResult)
          uiState.setPopupWhoisNick(null)
        } else {
          uiState.showWhois(whoisResult)
        }

        // Request avatar metadata for this user if supported
        const caps = useServerStore.getState().capabilities[serverId] ?? []
        if (caps.includes('draft/metadata-2') && data.nick) {
          api.invoke('metadata:get', serverId, data.nick, 'avatar').catch(() => {})
        }
      })
    )

    // MOTD display — show as system messages in a special '*' channel
    cleanups.push(
      api.on('irc:motd', ({ serverId, lines }) => {
        const motdText = lines.join('\n')
        useMessageStore.getState().addMessage(serverId, '*', {
          id: `motd-${serverId}-${Date.now()}`,
          serverId,
          channel: '*',
          nick: '',
          userHost: null,
          content: motdText,
          type: 'motd',
          tags: {},
          replyTo: null,
          timestamp: new Date().toISOString(),
          account: null,
          pending: false,
          reactions: {},
          channelContext: null
        })
      })
    )

    return () => {
      for (const cleanup of cleanups) {
        cleanup()
      }
    }
  }, [])
}
