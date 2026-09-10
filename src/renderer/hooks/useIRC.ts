import { useEffect } from 'react'
import { useServerStore } from '../stores/serverStore'
import { useChannelStore } from '../stores/channelStore'
import { useMessageStore } from '../stores/messageStore'
import { useUserStore } from '../stores/userStore'
import { useUIStore, syncThemeFromSettings } from '../stores/uiStore'
import { isChannelName, isServiceNick } from '@shared/constants'
import { namesYou } from '@shared/mentions'
import { asksForIdentification, confirmsIdentification } from '@shared/services'

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

        // Read back our own avatar now we are actually on the network. Asking
        // at capability negotiation is too early when SASL is in play: the
        // server answers 451 and we never find out.
        const caps = useServerStore.getState().capabilities[serverId] ?? []
        if (caps.includes('draft/metadata-2')) {
          api.invoke('metadata:get', serverId, '*', 'avatar').catch(() => {})
        }
      })
    )

    cleanups.push(
      api.on('irc:disconnected', ({ serverId }) => {
        useServerStore.getState().setConnectionStatus(serverId, 'disconnected')
      })
    )

    cleanups.push(
      api.on('irc:cap', ({ serverId, capabilities, values }) => {
        useServerStore.getState().setCapabilities(serverId, capabilities, values)
      })
    )

    // Track channels that need chathistory but haven't been fetched yet
    const pendingChathistory = new Set<string>()
    // Track channels where chathistory has already been requested (prevents re-requests)
    const chathistoryFetched = new Set<string>()

    // Channel events
    cleanups.push(
      api.on('irc:join', ({ serverId, channel, user, isMe }) => {
        useChannelStore.getState().addChannel(serverId, channel)
        useUserStore.getState().addUser(serverId, channel, user)

        // Only our own arrival is a reason to go looking for history. This ran
        // on everybody's, so a busy channel hit the database once per join.
        if (!isMe) return

        // Load local history first
        const channelKey = `${serverId}:${channel.toLowerCase()}`
        api
          .invoke('history:fetch', serverId, channel, undefined, 50)
          .then((messages) => {
            if (messages && messages.length > 0) {
              useMessageStore.getState().setMessages(serverId, channel, messages)
              chathistoryFetched.add(channelKey)

              // And then ask the network what happened after it. Local history is
              // what *this machine* saw, and the whole point of the other device
              // is that things happen while this one is closed — so stopping here
              // meant an evening spent on the phone was simply missing when you
              // sat back down, and nothing ever asked for it again.
              const newest = messages[messages.length - 1]?.timestamp
              if (newest) {
                void api.invoke('chathistory:catchup', serverId, channel, newest, 100)
              }
            } else {
              // No local history — only fetch from server if this is the active channel
              const activeChannel = useChannelStore.getState().activeChannel[serverId]
              if (activeChannel?.toLowerCase() === channel.toLowerCase()) {
                chathistoryFetched.add(channelKey)
                api.invoke('chathistory:request', serverId, channel, undefined, 50)
              } else {
                // Defer until the user switches to this channel
                pendingChathistory.add(channelKey)
              }
            }
          })
          .catch((err) => console.warn('Could not load history for', channel, err))
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
      api.on('irc:part', ({ serverId, channel, nick, isMe }) => {
        useUserStore.getState().removeUser(serverId, channel, nick)
        // We left — drop the channel rather than leaving a dead row behind
        if (isMe) {
          useChannelStore.getState().removeChannel(serverId, channel)
        }
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

    // Server errors and bad commands were being dropped silently
    cleanups.push(
      api.on('irc:error', ({ serverId, code, command, message }) => {
        const server = useServerStore.getState().servers.find((s) => s.id === serverId)

        // A login that failed is not one refusal among many. The connection
        // carries on regardless, and the user spends the evening on their own
        // network as a stranger without being told why — so it stays up, and
        // offers the way in.
        if (command === 'SASL') {
          useUIStore.getState().addToast({
            title: 'Logging in failed',
            body: message,
            action: { kind: 'account', label: 'Log in', serverId },
            sticky: true
          })
          return
        }

        useUIStore.getState().addToast({
          title: code === 'COMMAND' ? 'Command' : server?.name || 'Server error',
          body: message
        })
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
        // Auto-create channel entry for incoming DMs (only for real user messages, not services)
        const isService = isServiceNick(channel)
        if (
          !isChannelName(channel) &&
          channel !== '*' &&
          !isService &&
          (message.type === 'privmsg' || message.type === 'action')
        ) {
          useChannelStore.getState().addChannel(serverId, channel)
        }

        // Route service messages to the server console channel
        const effectiveChannel = isService ? '*' : channel
        useMessageStore.getState().addMessage(serverId, effectiveChannel, message)

        // NickServ, asking us to log in. On most of IRC this notice is the
        // first thing that happens after connecting, and it arrives as a
        // message from a stranger in a conversation nobody was looking at —
        // which is why people who have never heard of NickServ never find out
        // that they were supposed to do something about it.
        // Replayed history arrives on `irc:chathistory`, never here, so
        // anything reaching this point is something being said now.
        if (isService) {
          const store = useServerStore.getState()
          if (confirmsIdentification(message.content)) {
            useUIStore.getState().removeToastsFor(serverId)
          } else if (asksForIdentification(message.content) && !store.account[serverId]) {
            useUIStore.getState().addToast({
              title: 'This nick is registered',
              body: 'Log in to use it, and this network will do it for you from now on.',
              action: { kind: 'account', label: 'Log in', serverId },
              sticky: true
            })
          }
        }

        // Check if this channel is currently active
        const activeServerId = useServerStore.getState().activeServerId
        const activeChannel = useChannelStore.getState().activeChannel[serverId]
        const isActiveChannel = serverId === activeServerId && effectiveChannel === activeChannel

        // One rule, shared with the phone and checked against the same corpus:
        // a mention that rings one device and not the other is two clients.
        const myNick = currentNicks[serverId] || ''
        const isMention = namesYou(message.content, myNick)
        const isPrivate = !isChannelName(channel) && channel !== '*' && !isService

        if (!isActiveChannel) {
          // Service messages get unread but not mention badges
          useChannelStore
            .getState()
            .incrementUnread(serverId, effectiveChannel, !isService && (isMention || isPrivate))
        }

        // Desktop notification for mentions and PMs (not for services or muted servers)
        const isServerMuted = useServerStore.getState().isServerMuted(serverId)
        if ((isMention || isPrivate) && !isActiveChannel && !isService && !isServerMuted) {
          const uiState = useUIStore.getState()
          if (uiState.notificationsEnabled) {
            const title = isPrivate ? `PM from ${message.nick}` : `${message.nick} in ${channel}`
            api.invoke('notification:send', title, message.content.slice(0, 200))
          }

          // Update tray badge — recalculate after the increment above
          setTimeout(() => {
            const allChannels = useChannelStore.getState().channels
            let totalMentions = 0
            for (const chs of Object.values(allChannels)) {
              totalMentions += chs.reduce((sum, ch) => sum + ch.mentionCount, 0)
            }
            api.invoke('tray:set-badge', totalMentions)
          }, 0)
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
        // If it's our own nick, update the server-level away state
        const ourNick = useServerStore.getState().currentNick[serverId]
        if (ourNick && nick.toLowerCase() === ourNick.toLowerCase()) {
          useServerStore.getState().setAwayMessage(serverId, message)
        }
      })
    )

    // Account change notifications
    cleanups.push(
      api.on('irc:account', ({ serverId, nick, account }) => {
        // Our own login state, which the account panel is built on. Everyone
        // else's belongs on their roster entry, which is what follows.
        if (useServerStore.getState().currentNick[serverId]?.toLowerCase() === nick.toLowerCase()) {
          useServerStore.getState().setAccount(serverId, account)
          if (account) useUIStore.getState().removeToastsFor(serverId)
        }

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
        // Don't show our own typing indicator
        const ourNick = useServerStore.getState().currentNick[serverId]
        if (ourNick && nick.toLowerCase() === ourNick.toLowerCase()) return

        const isTyping = status === 'active' || status === 'paused'
        useMessageStore.getState().setTyping(serverId, channel, nick, isTyping)

        // Clear any existing timer for this user
        const timerKey = `${serverId}:${channel}:${nick}`
        const existing = typingTimers.get(timerKey)
        if (existing) clearTimeout(existing)

        if (isTyping) {
          // Auto-clear after 6 seconds if no update
          typingTimers.set(
            timerKey,
            setTimeout(() => {
              useMessageStore.getState().setTyping(serverId, channel, nick, false)
              typingTimers.delete(timerKey)
            }, 6000)
          )
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
      api.on('irc:react', ({ serverId, channel, nick, msgid, emoji, removed }) => {
        useMessageStore.getState().setReaction(serverId, channel, msgid, nick, emoji, !removed)
      })
    )

    cleanups.push(
      api.on('irc:redact', ({ serverId, channel, msgid }) => {
        useMessageStore.getState().removeMessage(serverId, channel, msgid)
      })
    )

    // Message edits (draft/edit)
    cleanups.push(
      api.on('irc:edit', ({ serverId, channel, originalId, newContent, editedAt }) => {
        useMessageStore.getState().editMessage(serverId, channel, originalId, newContent, editedAt)
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
        useServerStore.getState().setUserMetadata(serverId, target, key, value)
      })
    )

    // Network icon (ISUPPORT draft/ICON)
    cleanups.push(
      api.on('irc:network-icon', ({ serverId, url }) => {
        useServerStore.getState().setNetworkIcon(serverId, url)
      })
    )

    // Filehost (ISUPPORT draft/FILEHOST)
    cleanups.push(
      api.on('irc:filehost', ({ serverId, url }) => {
        useServerStore.getState().setFilehostUrl(serverId, url)
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

        // Somebody read this — on the phone, most likely, since that is what
        // MARKREAD is for. Drawing the divider and leaving the badge lit means
        // catching up in bed and still finding forty unread in the morning,
        // which is the thing draft/read-marker exists to prevent.
        //
        // Only when there is nothing newer than the marker: a channel that has
        // moved on since it was read is genuinely unread again.
        const key = `${serverId}:${channel.toLowerCase()}`
        const held = useMessageStore.getState().messages[key] ?? []
        const newest = held[held.length - 1]?.timestamp
        if (!newest || newest <= timestamp) {
          useChannelStore.getState().clearUnread(serverId, channel)
        }
      })
    )

    /**
     * A conversation somebody started while this device was closed.
     *
     * Channels are covered by rejoining them. A DM is not: nothing is joined,
     * so a message from somebody new leaves no trace for a client that was not
     * there. We only go looking for the history of conversations we have no
     * record of at all — the rest is already on screen.
     */
    cleanups.push(
      api.on('irc:chathistory-target', ({ serverId, target }) => {
        if (isChannelName(target) || isServiceNick(target)) return

        const known = useChannelStore
          .getState()
          .channels[serverId]?.some((ch) => ch.name.toLowerCase() === target.toLowerCase())
        if (known) return

        useChannelStore.getState().addChannel(serverId, target)
        api.invoke('chathistory:request', serverId, target, undefined, 50)
      })
    )

    // On connect, load read markers from DB and monitor list
    cleanups.push(
      api.on('irc:connected', ({ serverId: sid, account }) => {
        useServerStore.getState().setAccount(sid, account)

        // What happened while we were shut. A fortnight is long enough to
        // cover a weekend away and short enough that the list stays readable;
        // the server caps it anyway.
        const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString()
        api.invoke('chathistory:targets', sid, since)

        api.invoke('read-marker:get-all', sid).then((markers) => {
          if (markers && Object.keys(markers).length > 0) {
            useChannelStore.getState().setReadMarkers(sid, markers)
          }
        })

        // Load persisted friend list
        api.invoke('monitor:list', sid).then((nicks) => {
          if (nicks && nicks.length > 0) {
            useUserStore.getState().setMonitorList(sid, nicks)
            // Request current online status
            api.invoke('monitor:status', sid)
          }
        })
      })
    )

    // Invite notifications
    cleanups.push(
      api.on('irc:invite', ({ serverId, channel, by }) => {
        useUIStore.getState().addToast({
          title: `Channel Invite`,
          body: `${by} invited you to ${channel}`,
          action: { kind: 'join', label: 'Join', serverId, channel }
        })

        // Desktop notification
        const isServerMuted = useServerStore.getState().isServerMuted(serverId)
        if (useUIStore.getState().notificationsEnabled && !isServerMuted) {
          api.invoke(
            'notification:send',
            `Invited to ${channel}`,
            `${by} invited you to ${channel}`
          )
        }
      })
    )

    /**
     * The watched list changed somewhere other than here.
     *
     * The server only ever echoes who is *online*, never who is on the list,
     * so a friend added from the phone was invisible on the desktop — and
     * their online notice arrived for a nick this window did not think it was
     * watching.
     */
    cleanups.push(
      api.on('monitor:changed', ({ serverId }) => {
        api.invoke('monitor:list', serverId).then((nicks) => {
          useUserStore.getState().setMonitorList(serverId, nicks ?? [])
          if (nicks && nicks.length > 0) api.invoke('monitor:status', serverId)
        })
      })
    )

    /**
     * A shared setting changed somewhere other than here.
     *
     * The theme is the one that shows: both clients share it deliberately, and
     * picking one on the phone left this window on the old one until restart.
     * Re-reading is a no-op when this window is the one that set it.
     */
    cleanups.push(
      api.on('settings:changed', ({ key }) => {
        if (key === 'theme') void syncThemeFromSettings()
      })
    )

    // Monitor online/offline events
    cleanups.push(
      api.on('irc:monitor-online', ({ serverId, nick }) => {
        useUserStore.getState().setMonitorOnline(serverId, nick)
      })
    )

    cleanups.push(
      api.on('irc:monitor-offline', ({ serverId, nick }) => {
        useUserStore.getState().setMonitorOffline(serverId, nick)
      })
    )

    // Netsplit/netjoin collapsed events
    cleanups.push(
      api.on('irc:netsplit', ({ serverId, server1, server2, nicks }) => {
        const content =
          nicks.length === 1
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
        const content =
          nicks.length === 1
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

    // When user switches to a channel that has deferred chathistory, fetch it
    const unsubscribe = useChannelStore.subscribe((state, prevState) => {
      const activeServerId = useServerStore.getState().activeServerId
      if (!activeServerId) return
      const channel = state.activeChannel[activeServerId]
      const prevChannel = prevState.activeChannel[activeServerId]
      if (!channel || channel === prevChannel) return
      const chKey = `${activeServerId}:${channel.toLowerCase()}`
      if (pendingChathistory.has(chKey) && !chathistoryFetched.has(chKey)) {
        pendingChathistory.delete(chKey)
        chathistoryFetched.add(chKey)
        api.invoke('chathistory:request', activeServerId, channel, undefined, 50)
      }
    })

    // Listeners are attached — tell main, which holds auto-connect until now.
    // Anything already live (a reload, or a connection that raced this effect)
    // comes back as a snapshot, because those events are not replayed.
    // A theme picked on the phone, or on this machine before a reinstall
    void syncThemeFromSettings()

    api
      .invoke('app:renderer-ready')
      .then((snapshot) => {
        for (const server of snapshot) {
          const { serverId } = server
          useServerStore.getState().setConnectionStatus(serverId, 'connected')
          useServerStore.getState().setCurrentNick(serverId, server.nick)
          useServerStore
            .getState()
            .setCapabilities(serverId, server.capabilities, server.capabilityValues)
          useServerStore.getState().setAccount(serverId, server.account)
          currentNicks[serverId] = server.nick

          // Display names, colours and avatars the core already knows about
          for (const [nick, profile] of Object.entries(server.metadata ?? {})) {
            for (const [key, value] of Object.entries(profile)) {
              if (value) useServerStore.getState().setUserMetadata(serverId, nick, key, value)
            }
          }

          for (const channel of server.channels) {
            useChannelStore.getState().addChannel(serverId, channel.name)
            useUserStore.getState().setUsers(serverId, channel.name, channel.users)
            if (channel.topic) {
              useChannelStore
                .getState()
                .setTopic(serverId, channel.name, channel.topic, channel.topicSetBy)
            }

            api
              .invoke('history:fetch', serverId, channel.name, undefined, 50)
              .then((messages) => {
                if (messages && messages.length > 0) {
                  useMessageStore.getState().setMessages(serverId, channel.name, messages)
                }
              })
              .catch(() => {})
          }
        }
      })
      .catch((err) => {
        console.error('Failed to sync connection state from main:', err)
      })

    return () => {
      unsubscribe()
      for (const cleanup of cleanups) {
        cleanup()
      }
    }
  }, [])
}
