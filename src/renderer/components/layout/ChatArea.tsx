import { useRef, useEffect, useState, useCallback, useMemo } from 'react'
import { useServerStore } from '../../stores/serverStore'
import { useChannelStore } from '../../stores/channelStore'
import { useMessageStore, type ReplyTarget } from '../../stores/messageStore'
import { useUserStore } from '../../stores/userStore'
import type { ChannelUser } from '@shared/types/channel'
import { SwitchboardIcon } from '../common/SwitchboardIcon'
import { isChannelName } from '@shared/constants'

const STABLE_EMPTY_USERS: ChannelUser[] = []
const STABLE_EMPTY_CHANNELS: { name: string; serverId: string; topic: string | null; topicSetBy: string | null; unreadCount: number; mentionCount: number; muted: boolean }[] = []
import { MessageItem } from '../chat/MessageItem'
import { MessageComposer } from '../chat/MessageComposer'
import { TypingIndicator } from '../chat/TypingIndicator'
import type { ChatMessage } from '@shared/types/message'

const EMPTY_MESSAGES: ChatMessage[] = []
const EMPTY_NICKS: string[] = []

export function ChatArea() {
  const activeServerId = useServerStore((s) => s.activeServerId)
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

  // Reset history state when channel changes
  useEffect(() => {
    setHistoryExhausted(false)
  }, [key])

  // Track the initial read marker when entering a channel (so divider doesn't move)
  const initialReadMarker = useRef<string | null>(null)
  useEffect(() => {
    initialReadMarker.current = readMarkerTimestamp
  }, [key]) // Only reset when channel changes, not when readMarkerTimestamp updates

  // Mark channel as read when viewing it
  useEffect(() => {
    if (!activeServerId || !activeChannel || messages.length === 0) return
    const lastMsg = messages[messages.length - 1]
    if (lastMsg) {
      window.switchboard.invoke('read-marker:set', activeServerId, activeChannel, lastMsg.timestamp)
      useChannelStore.getState().setReadMarker(activeServerId, activeChannel, lastMsg.timestamp)
    }
  }, [activeServerId, activeChannel, messages.length])

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
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
        setTimeout(() => {
          const currentMessages = useMessageStore.getState().messages[`${activeServerId}:${activeChannel.toLowerCase()}`] || []
          if (currentMessages.length === messages.length) {
            setHistoryExhausted(true)
          }
        }, 3000)
      }
    } finally {
      setLoadingHistory(false)
    }
  }, [activeServerId, activeChannel, messages, loadingHistory, historyExhausted])

  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current
    setAutoScroll(scrollHeight - scrollTop - clientHeight < 100)

    // Load older messages when scrolled near top
    if (scrollTop < 100 && !loadingHistory) {
      loadOlderMessages()
    }
  }, [loadingHistory, loadOlderMessages])

  const handleSend = useCallback(
    (text: string) => {
      if (!activeServerId || !activeChannel) return
      window.switchboard.invoke('message:send', activeServerId, activeChannel, text)
    },
    [activeServerId, activeChannel]
  )

  const handleSendReply = useCallback(
    (text: string, replyTo: string) => {
      if (!activeServerId || !activeChannel) return
      window.switchboard.invoke('message:reply', activeServerId, activeChannel, text, replyTo)
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
        className="chat-messages flex-1 overflow-y-auto px-4 py-2"
      >
        {/* Loading history indicator */}
        {loadingHistory && (
          <div className="flex justify-center py-2">
            <span className="text-xs text-gray-500">Loading older messages...</span>
          </div>
        )}

        {messages.length === 0 && (
          <div className="flex h-full items-end pb-4">
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
          // Show "New messages" divider
          const showDivider =
            initialReadMarker.current &&
            i > 0 &&
            messages[i - 1].timestamp <= initialReadMarker.current &&
            msg.timestamp > initialReadMarker.current

          return (
            <div key={msg.id}>
              {showDivider && (
                <div className="my-2 flex items-center gap-2">
                  <div className="flex-1 border-t border-red-500/50" />
                  <span className="text-xs font-medium text-red-400">New messages</span>
                  <div className="flex-1 border-t border-red-500/50" />
                </div>
              )}
              <MessageItem
                message={msg}
                prevMessage={i > 0 ? messages[i - 1] : null}
                onReply={handleReply}
              />
            </div>
          )
        })}
      </div>

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
    window.switchboard.invoke('message:send', serverId, '*', text)
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
