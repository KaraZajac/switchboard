import { useCallback } from 'react'
import type { ChatMessage } from '@shared/types/message'
import { MessageContent } from './MessageContent'
import { useMessageStore } from '../../stores/messageStore'

interface MessageItemProps {
  message: ChatMessage
  prevMessage: ChatMessage | null
  onReply?: (message: ChatMessage) => void
}

export function MessageItem({ message, prevMessage, onReply }: MessageItemProps) {
  const isAction = message.type === 'action'
  const isNotice = message.type === 'notice'
  const isSystem = message.type === 'system'

  // Group messages from same nick within 5 minutes
  const isGrouped =
    prevMessage &&
    prevMessage.nick === message.nick &&
    prevMessage.type === message.type &&
    !isAction &&
    !isSystem &&
    !message.replyTo &&
    timeDiffMinutes(prevMessage.timestamp, message.timestamp) < 5

  const time = formatTime(message.timestamp)

  if (isAction) {
    return (
      <div className="group relative flex items-start px-2 py-0.5 hover:bg-gray-800/30">
        <span className="mr-2 mt-0.5 min-w-[48px] text-right text-xs text-gray-500 opacity-0 group-hover:opacity-100">
          {time}
        </span>
        <div className="flex-1">
          <span className="italic text-gray-300">
            <span className="font-medium text-gray-100">{message.nick}</span>{' '}
            <MessageContent text={message.content} />
          </span>
          <MessageActions message={message} onReply={onReply} />
        </div>
      </div>
    )
  }

  if (isSystem) {
    return (
      <div className="group relative flex items-start px-2 py-0.5 hover:bg-gray-800/30">
        <span className="mr-2 mt-0.5 min-w-[48px] text-right text-xs text-gray-500 opacity-0 group-hover:opacity-100">
          {time}
        </span>
        <span className="text-sm text-gray-500"><MessageContent text={message.content} /></span>
      </div>
    )
  }

  if (isGrouped) {
    return (
      <div className="group relative flex items-start px-2 py-0.5 hover:bg-gray-800/30">
        <span className="mr-2 mt-0.5 min-w-[48px] text-right text-xs text-gray-500 opacity-0 group-hover:opacity-100">
          {time}
        </span>
        <div className="flex-1">
          <span className={isNotice ? 'text-gray-400' : 'text-gray-200'}>
            <MessageContent text={message.content} />
          </span>
          {Object.keys(message.reactions).length > 0 && (
            <Reactions reactions={message.reactions} />
          )}
          <MessageActions message={message} onReply={onReply} />
        </div>
      </div>
    )
  }

  return (
    <div className="group relative mt-3 flex items-start px-2 py-0.5 first:mt-0 hover:bg-gray-800/30">
      {/* Avatar placeholder */}
      <div className="mr-3 mt-0.5 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-indigo-600 text-sm font-bold text-white">
        {message.nick.charAt(0).toUpperCase()}
      </div>

      <div className="flex-1 overflow-hidden">
        {/* Reply preview */}
        {message.replyTo && (
          <ReplyPreview serverId={message.serverId} channel={message.channel} msgid={message.replyTo} />
        )}

        <div className="flex items-baseline gap-2">
          <span className="font-medium text-gray-100 hover:underline cursor-pointer">
            {message.nick}
          </span>
          <span className="text-xs text-gray-500">{formatTimeFull(message.timestamp)}</span>
          {message.channelContext && (
            <span className="rounded bg-gray-700/50 px-1.5 py-0.5 text-[10px] text-gray-400">
              from {message.channelContext}
            </span>
          )}
          {message.pending && (
            <span className="text-xs text-gray-600">sending...</span>
          )}
        </div>
        <div className={isNotice ? 'text-gray-400' : 'text-gray-200'}>
          <MessageContent text={message.content} />
        </div>
        {Object.keys(message.reactions).length > 0 && (
          <Reactions reactions={message.reactions} />
        )}
        <MessageActions message={message} onReply={onReply} />
      </div>
    </div>
  )
}

/** Shows a compact preview of the message being replied to */
function ReplyPreview({ serverId, channel, msgid }: { serverId: string; channel: string; msgid: string }) {
  const originalMsg = useMessageStore((s) => s.getMessageById(serverId, channel, msgid))

  return (
    <div className="mb-1 flex items-center gap-1.5 text-xs">
      <svg className="h-3 w-3 flex-shrink-0 text-gray-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
        <path d="M9 17l-5-5 5-5" />
        <path d="M4 12h12a4 4 0 0 1 0 8h-1" />
      </svg>
      {originalMsg ? (
        <>
          <span className="font-medium text-gray-300">{originalMsg.nick}</span>
          <span className="truncate text-gray-500">{originalMsg.content.slice(0, 100)}</span>
        </>
      ) : (
        <span className="italic text-gray-600">Original message not loaded</span>
      )}
    </div>
  )
}

/** Hover actions for a message (reply button) */
function MessageActions({ message, onReply }: { message: ChatMessage; onReply?: (message: ChatMessage) => void }) {
  if (!onReply || message.type === 'system') return null

  return (
    <div className="absolute -top-3 right-2 flex gap-0.5 rounded border border-gray-700 bg-gray-800 opacity-0 shadow-sm transition-opacity group-hover:opacity-100">
      <button
        onClick={() => onReply(message)}
        className="rounded px-2 py-1 text-gray-400 hover:bg-gray-700 hover:text-gray-200"
        title="Reply"
      >
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M9 17l-5-5 5-5" />
          <path d="M4 12h12a4 4 0 0 1 0 8h-1" />
        </svg>
      </button>
    </div>
  )
}

function Reactions({ reactions }: { reactions: Record<string, string[]> }) {
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {Object.entries(reactions).map(([emoji, nicks]) => (
        <button
          key={emoji}
          className="flex items-center gap-1 rounded-full border border-gray-700 bg-gray-800 px-2 py-0.5 text-sm hover:bg-gray-700"
          title={nicks.join(', ')}
        >
          <span>{emoji}</span>
          <span className="text-xs text-gray-400">{nicks.length}</span>
        </button>
      ))}
    </div>
  )
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}

function formatTimeFull(iso: string): string {
  try {
    const d = new Date(iso)
    const today = new Date()
    if (d.toDateString() === today.toDateString()) {
      return 'Today at ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) +
      ' at ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}

function timeDiffMinutes(a: string, b: string): number {
  try {
    return (new Date(b).getTime() - new Date(a).getTime()) / 60000
  } catch {
    return Infinity
  }
}
