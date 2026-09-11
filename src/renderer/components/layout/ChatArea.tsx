import { useRef, useEffect, useLayoutEffect, useState, useCallback, useMemo } from 'react'
import { useServerStore } from '../../stores/serverStore'
import { useChannelStore } from '../../stores/channelStore'
import { useMessageStore } from '../../stores/messageStore'
import { useUserStore } from '../../stores/userStore'
import { useUIStore } from '../../stores/uiStore'
import type { ChannelUser } from '@shared/types/channel'
import { SwitchboardIcon } from '../common/SwitchboardIcon'
import { isChannelName } from '@shared/constants'
import { speak } from '../../utils/speak'

const STABLE_EMPTY_USERS: ChannelUser[] = []
const STABLE_EMPTY_CHANNELS: { name: string; serverId: string; topic: string | null; topicSetBy: string | null; unreadCount: number; mentionCount: number; muted: boolean }[] = []
import { MessageItem } from '../chat/MessageItem'
import { MessageComposer } from '../chat/MessageComposer'
import { TypingIndicator } from '../chat/TypingIndicator'
import type { ChatMessage } from '@shared/types/message'
import { Transfers } from '../chat/Transfers'

const EMPTY_MESSAGES: ChatMessage[] = []
const EMPTY_NICKS: string[] = []

export function ChatArea() {
  const activeServerId = useServerStore((s) => s.activeServerId)
  const dmMode = useUIStore((s) => s.dmMode)
  const activeChannel = useChannelStore((s) =>
    activeServerId ? s.activeChannel[activeServerId] ?? null : null
  )
  const connectionStatus = useServerStore((s) =>
    activeServerId ? s.connectionStatus[activeServerId] ?? 'disconnected' : 'disconnected'
  )

  const key = activeServerId && activeChannel
    ? `${activeServerId}:${activeChannel.toLowerCase()}`
    : null
  const messages = useMessageStore((s) => (key ? s.messages[key] ?? EMPTY_MESSAGES : EMPTY_MESSAGES))
  const typingNicks = useMessageStore((s) => (key ? s.typing[key] ?? EMPTY_NICKS : EMPTY_NICKS))
  const replyTarget = useMessageStore((s) => (key ? s.replyTarget[key] ?? null : null))
  const readMarkerTimestamp = useChannelStore((s) =>
    key ? s.readMarkers[key] ?? null : null
  )

  const channelUsers = useUserStore((s) => (key ? s.users[key] ?? STABLE_EMPTY_USERS : STABLE_EMPTY_USERS))
  const serverChannelInfos = useChannelStore((s) =>
    activeServerId ? s.channels[activeServerId] ?? STABLE_EMPTY_CHANNELS : STABLE_EMPTY_CHANNELS
  )
  const serverChannels = useMemo(
    () => serverChannelInfos.map((ch) => ch.name),
    [serverChannelInfos]
  )

  const scrollRef = useRef<HTMLDivElement>(null)
  const [autoScroll, setAutoScroll] = useState(true)
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [historyExhausted, setHistoryExhausted] = useState(false)
  // Persist exhaustion across channel switches so we don't re-request
  const exhaustedChannels = useRef<Set<string>>(new Set())

  // Save/restore scroll positions per channel
  const scrollPositions = useRef<Record<string, { top: number; atBottom: boolean }>>({})
  const prevKey = useRef<string | null>(null)
  // Ref for the "New messages" divider element
  const newMessagesDividerRef = useRef<HTMLDivElement>(null)
  // Whether we're in the middle of a channel switch (blocks auto-scroll effect)
  const isRestoringScroll = useRef(false)
  // Track what we've already scrolled for to avoid duplicate work
  const scrolledForKey = useRef<string | null>(null)

  // Track the initial read marker — set synchronously during render so the
  // divider renders correctly on the FIRST paint after a channel switch
  const initialReadMarker = useRef<string | null>(null)
  const lastReadMarkerKey = useRef<string | null>(null)
  if (key !== lastReadMarkerKey.current) {
    initialReadMarker.current = readMarkerTimestamp
    lastReadMarkerKey.current = key
  }

  // Save previous channel's scroll position and prepare for restore
  useEffect(() => {
    if (prevKey.current && scrollRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = scrollRef.current
      scrollPositions.current[prevKey.current] = {
        top: scrollTop,
        atBottom: scrollHeight - scrollTop - clientHeight < 100
      }
    }

    setHistoryExhausted(key ? exhaustedChannels.current.has(key) : false)

    // Begin restoration mode — blocks auto-scroll effect until we're done
    isRestoringScroll.current = true
    scrolledForKey.current = null

    prevKey.current = key
  }, [key])

  // Scroll restoration — runs synchronously after DOM update, before paint.
  // Triggers on channel switch AND when messages load (for async message arrival).
  useLayoutEffect(() => {
    if (!isRestoringScroll.current) return
    if (!scrollRef.current || messages.length === 0) return
    // Only run once per channel switch (unless message count was 0 and now loaded)
    if (scrolledForKey.current === key) return
    scrolledForKey.current = key

    const saved = key ? scrollPositions.current[key] : null

    // Priority:
    // 1) If there's a "New messages" divider, scroll to it
    // 2) If we have a saved position (user was scrolled up), restore it
    // 3) Otherwise, scroll to bottom (default for all servers, with or without read markers)
    if (newMessagesDividerRef.current) {
      newMessagesDividerRef.current.scrollIntoView({ block: 'start' })
      // Show a bit of context above the divider
      if (scrollRef.current.scrollTop > 50) {
        scrollRef.current.scrollTop -= 50
      }
      setAutoScroll(false)
    } else if (saved && !saved.atBottom) {
      scrollRef.current.scrollTop = saved.top
      setAutoScroll(false)
    } else {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
      setAutoScroll(true)
    }

    isRestoringScroll.current = false
  }, [key, messages.length])

  // Mark channel as read when at bottom (on channel switch or new messages)
  useEffect(() => {
    if (!activeServerId || !activeChannel || messages.length === 0 || !autoScroll) return
    const lastMsg = messages[messages.length - 1]
    if (lastMsg) {
      window.switchboard.invoke('read-marker:set', activeServerId, activeChannel, lastMsg.timestamp)
      useChannelStore.getState().setReadMarker(activeServerId, activeChannel, lastMsg.timestamp)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeServerId, activeChannel, messages.length, autoScroll])

  // Auto-scroll to bottom when new messages arrive (only when already at bottom, not during restore)
  useEffect(() => {
    if (isRestoringScroll.current) return
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages.length, autoScroll])

  const loadOlderMessages = useCallback(async () => {
    if (!activeServerId || !activeChannel || loadingHistory || historyExhausted) return
    if (messages.length === 0) return

    setLoadingHistory(true)
    const oldestTimestamp = messages[0]?.timestamp

    try {
      // Try local DB first
      const localMessages = await window.switchboard.invoke(
        'history:fetch', activeServerId, activeChannel, oldestTimestamp, 50
      )

      if (localMessages && localMessages.length > 0) {
        useMessageStore.getState().prependMessages(activeServerId, activeChannel, localMessages)
        // Maintain scroll position
        if (scrollRef.current) {
          const prevHeight = scrollRef.current.scrollHeight
          requestAnimationFrame(() => {
            if (scrollRef.current) {
              scrollRef.current.scrollTop = scrollRef.current.scrollHeight - prevHeight
            }
          })
        }
      } else {
        // Try server-side chathistory
        await window.switchboard.invoke(
          'chathistory:request', activeServerId, activeChannel, oldestTimestamp, 50
        )
        // If no local messages were found, mark exhausted after a delay
        // (server response may arrive via irc:chathistory event)
        const exhaustKey = `${activeServerId}:${activeChannel.toLowerCase()}`
        setTimeout(() => {
          const currentMessages = useMessageStore.getState().messages[exhaustKey] || []
          if (currentMessages.length === messages.length) {
            setHistoryExhausted(true)
            exhaustedChannels.current.add(exhaustKey)
          }
        }, 3000)
      }
    } finally {
      setLoadingHistory(false)
    }
  }, [activeServerId, activeChannel, messages, loadingHistory, historyExhausted])

  const lastMarkreadSent = useRef(0)

  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 100

    // When scrolling to bottom, mark as read and clear the "New messages" divider
    if (isAtBottom && !autoScroll && activeServerId && activeChannel && messages.length > 0) {
      const now = Date.now()
      if (now - lastMarkreadSent.current > 2000) {
        lastMarkreadSent.current = now
        const lastMsg = messages[messages.length - 1]
        window.switchboard.invoke('read-marker:set', activeServerId, activeChannel, lastMsg.timestamp)
        useChannelStore.getState().setReadMarker(activeServerId, activeChannel, lastMsg.timestamp)
        useChannelStore.getState().clearUnread(activeServerId, activeChannel)
      }
      initialReadMarker.current = null
    }

    setAutoScroll(isAtBottom)

    // Load older messages when scrolled near top
    if (scrollTop < 100 && !loadingHistory) {
      loadOlderMessages()
    }
  }, [loadingHistory, loadOlderMessages, autoScroll, activeServerId, activeChannel, messages])

  const handleSend = useCallback(
    (text: string) => {
      if (!activeServerId || !activeChannel) return
      speak(window.switchboard.invoke('message:send', activeServerId, activeChannel, text))
    },
    [activeServerId, activeChannel]
  )

  const handleSendReply = useCallback(
    (text: string, replyTo: string) => {
      if (!activeServerId || !activeChannel) return
      speak(
        window.switchboard.invoke('message:reply', activeServerId, activeChannel, text, replyTo)
      )
    },
    [activeServerId, activeChannel]
  )

  const handleReply = useCallback(
    (message: ChatMessage) => {
      if (!activeServerId || !activeChannel) return
      useMessageStore.getState().setReplyTarget(activeServerId, activeChannel, {
        id: message.id,
        nick: message.nick,
        content: message.content
      })
    },
    [activeServerId, activeChannel]
  )

  const handleCancelReply = useCallback(() => {
    if (!activeServerId || !activeChannel) return
    useMessageStore.getState().setReplyTarget(activeServerId, activeChannel, null)
  }, [activeServerId, activeChannel])

  // No server selected
  if (!activeServerId) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center">
          <SwitchboardIcon size={80} bg="transparent" fg="#4b5563" className="mx-auto mb-4" />
          <h2 className="mb-2 text-2xl font-bold text-gray-300">Welcome to Switchboard</h2>
          <p className="text-gray-500">Add a server to get started</p>
        </div>
      </div>
    )
  }

  // Not connected
  if (connectionStatus !== 'connected') {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center">
          <p className="text-gray-500">
            {connectionStatus === 'connecting' ? 'Connecting...' : 'Not connected to server'}
          </p>
        </div>
      </div>
    )
  }

  // In the DM view with no conversation open, the channel behind it is not what
  // the sidebar is showing — prompt for a conversation instead.
  if (dmMode && (!activeChannel || isChannelName(activeChannel) || activeChannel === '*')) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="max-w-sm text-center">
          <SwitchboardIcon size={64} bg="transparent" fg="#4b5563" className="mx-auto mb-4" />
          <h2 className="mb-2 text-xl font-semibold text-gray-300">Direct Messages</h2>
          <p className="text-sm text-gray-500">
            Pick a conversation on the left, or start a new one with the + button.
          </p>
        </div>
      </div>
    )
  }

  // No channel selected or server console — show server messages (MOTD, etc.)
  if (!activeChannel || activeChannel === '*') {
    return <ServerMessages serverId={activeServerId} />
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Messages */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="chat-messages flex flex-1 flex-col overflow-y-auto px-4 py-2"
      >
        {/* mt-auto keeps a short conversation pinned to the bottom */}
        <div className="mt-auto">
        {/* Loading history indicator */}
        {loadingHistory && (
          <div className="flex justify-center py-2">
            <span className="text-xs text-gray-500">Loading older messages...</span>
          </div>
        )}

        {messages.length === 0 && (
          <div className="flex items-end pb-4 pt-8">
            <div>
              {isChannelName(activeChannel) ? (
                <>
                  <h3 className="text-2xl font-bold text-gray-100">
                    Welcome to {activeChannel}
                  </h3>
                  <p className="mt-1 text-gray-400">
                    This is the start of the {activeChannel} channel.
                  </p>
                </>
              ) : (
                <>
                  <div className="mb-2 flex h-16 w-16 items-center justify-center rounded-full bg-gray-600 text-2xl font-bold text-gray-200">
                    {activeChannel.charAt(0).toUpperCase()}
                  </div>
                  <h3 className="text-2xl font-bold text-gray-100">
                    {activeChannel}
                  </h3>
                  <p className="mt-1 text-gray-400">
                    This is the beginning of your conversation with {activeChannel}.
                  </p>
                </>
              )}
            </div>
          </div>
        )}

        {messages.map((msg, i) => {
          const prev = i > 0 ? messages[i - 1] : null

          // Show "New messages" divider
          const showDivider =
            initialReadMarker.current &&
            prev &&
            prev.timestamp <= initialReadMarker.current &&
            msg.timestamp > initialReadMarker.current

          // A day boundary gets its own divider, and always starts a fresh
          // message header rather than grouping onto yesterday's last line.
          const startsNewDay = !prev || !isSameDay(prev.timestamp, msg.timestamp)

          return (
            <div key={msg.id}>
              {startsNewDay && <DateDivider timestamp={msg.timestamp} />}
              {showDivider && (
                <div ref={newMessagesDividerRef} className="my-2 flex items-center gap-2">
                  <div className="flex-1 border-t border-red-500/50" />
                  <span className="text-xs font-medium text-red-400">New messages</span>
                  <div className="flex-1 border-t border-red-500/50" />
                </div>
              )}
              <MessageItem
                message={msg}
                prevMessage={startsNewDay ? null : prev}
                onReply={handleReply}
              />
            </div>
          )
        })}
        </div>
      </div>

      {/* Back to the newest messages after scrolling up */}
      {!autoScroll && (
        <button
          onClick={() => {
            const el = scrollRef.current
            if (!el) return
            el.scrollTop = el.scrollHeight
            setAutoScroll(true)
          }}
          className="mx-4 mb-1 flex items-center justify-center gap-1.5 rounded-md bg-gray-700/90 py-1 text-xs font-medium text-gray-200 shadow-lg transition-colors hover:bg-gray-600"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M12 16.5l-6-6 1.41-1.41L12 13.67l4.59-4.58L18 10.5z" />
          </svg>
          Jump to present
        </button>
      )}

      {/*
        Files somebody is offering, in the conversation they offered them in.
        Only in a direct message: DCC is between two people, and an offer made
        to a channel is not how anybody sends a file to a person.
      */}
      {activeServerId && activeChannel && !isChannelName(activeChannel) && activeChannel !== '*' && (
        <Transfers serverId={activeServerId} peer={activeChannel} />
      )}

      {/* Typing indicator */}
      <TypingIndicator nicks={typingNicks} />

      {/* Composer */}
      <MessageComposer
        serverId={activeServerId}
        channel={activeChannel}
        onSend={handleSend}
        onSendReply={handleSendReply}
        replyTarget={replyTarget}
        onCancelReply={handleCancelReply}
        disabled={connectionStatus !== 'connected'}
        users={channelUsers}
        channels={serverChannels}
      />
    </div>
  )
}

function ServerMessages({ serverId }: { serverId: string }) {
  const key = `${serverId}:*`
  const messages = useMessageStore((s) => s.messages[key] ?? EMPTY_MESSAGES)
  const [command, setCommand] = useState('')

  const handleCommand = useCallback(() => {
    const text = command.trim()
    if (!text) return
    speak(window.switchboard.invoke('message:send', serverId, '*', text), 'That command did not run')
    setCommand('')
  }, [serverId, command])

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto px-4 py-2">
        {messages.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-gray-500">Server console — use /commands here</p>
          </div>
        ) : (
          messages.map((msg) => (
            <div key={msg.id} className="mb-4">
              {msg.type === 'motd' && (
                <div className="rounded bg-gray-800/50 p-4">
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
                    Message of the Day
                  </div>
                  <pre className="whitespace-pre-wrap font-mono text-sm text-gray-300">
                    {msg.content}
                  </pre>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Command input for server console */}
      <div className="border-t border-gray-700 px-4 py-3">
        <input
          type="text"
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleCommand() }}
          placeholder="Enter a /command..."
          className="w-full rounded-lg bg-gray-700 px-4 py-2.5 text-sm text-gray-100 placeholder-gray-400 outline-none focus:ring-1 focus:ring-indigo-500"
        />
      </div>
    </div>
  )
}

/** Same calendar day in the viewer's timezone */
function isSameDay(a: string, b: string): boolean {
  const dateA = new Date(a)
  const dateB = new Date(b)
  return (
    dateA.getFullYear() === dateB.getFullYear() &&
    dateA.getMonth() === dateB.getMonth() &&
    dateA.getDate() === dateB.getDate()
  )
}

function dayLabel(iso: string): string {
  const date = new Date(iso)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)

  if (isSameDay(iso, today.toISOString())) return 'Today'
  if (isSameDay(iso, yesterday.toISOString())) return 'Yesterday'

  const sameYear = date.getFullYear() === today.getFullYear()
  return date.toLocaleDateString([], {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' })
  })
}

/** Date separator between days of conversation */
function DateDivider({ timestamp }: { timestamp: string }) {
  const label = dayLabel(timestamp)
  if (!label) return null

  return (
    <div className="my-4 flex items-center gap-3 no-select" aria-label={label}>
      <div className="h-px flex-1 bg-gray-700" />
      <span className="shrink-0 text-xs font-semibold text-gray-400">{label}</span>
      <div className="h-px flex-1 bg-gray-700" />
    </div>
  )
}
