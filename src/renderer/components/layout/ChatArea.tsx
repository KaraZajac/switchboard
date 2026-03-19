import { useRef, useEffect, useState, useCallback } from 'react'
import { useServerStore } from '../../stores/serverStore'
import { useChannelStore } from '../../stores/channelStore'
import { useMessageStore } from '../../stores/messageStore'
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
    ? `${activeServerId}:${activeChannel}`
    : null
  const messages = useMessageStore((s) => (key ? s.messages[key] ?? EMPTY_MESSAGES : EMPTY_MESSAGES))
  const typingNicks = useMessageStore((s) => (key ? s.typing[key] ?? EMPTY_NICKS : EMPTY_NICKS))

  const scrollRef = useRef<HTMLDivElement>(null)
  const [autoScroll, setAutoScroll] = useState(true)

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages.length, autoScroll])

  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current
    // If user is within 100px of bottom, enable auto-scroll
    setAutoScroll(scrollHeight - scrollTop - clientHeight < 100)
  }, [])

  const handleSend = useCallback(
    (text: string) => {
      if (!activeServerId || !activeChannel) return
      window.switchboard.invoke('message:send', activeServerId, activeChannel, text)
    },
    [activeServerId, activeChannel]
  )

  // No server selected
  if (!activeServerId) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center">
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

  // No channel selected
  if (!activeChannel) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-gray-500">Select a channel or join one</p>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Messages */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-4 py-2"
      >
        {messages.length === 0 && (
          <div className="flex h-full items-end pb-4">
            <div>
              <h3 className="text-2xl font-bold text-gray-100">
                Welcome to {activeChannel}
              </h3>
              <p className="mt-1 text-gray-400">
                This is the start of the {activeChannel} channel.
              </p>
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <MessageItem
            key={msg.id}
            message={msg}
            prevMessage={i > 0 ? messages[i - 1] : null}
          />
        ))}
      </div>

      {/* Typing indicator */}
      <TypingIndicator nicks={typingNicks} />

      {/* Composer */}
      <MessageComposer
        channel={activeChannel}
        onSend={handleSend}
        disabled={connectionStatus !== 'connected'}
      />
    </div>
  )
}
