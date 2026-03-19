import type { ChatMessage } from '@shared/types/message'
import { MessageContent } from './MessageContent'

interface MessageItemProps {
  message: ChatMessage
  prevMessage: ChatMessage | null
}

export function MessageItem({ message, prevMessage }: MessageItemProps) {
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
    timeDiffMinutes(prevMessage.timestamp, message.timestamp) < 5

  const time = formatTime(message.timestamp)

  if (isAction) {
    return (
      <div className="group flex items-start px-2 py-0.5 hover:bg-gray-800/30">
        <span className="mr-2 mt-0.5 min-w-[48px] text-right text-xs text-gray-500 opacity-0 group-hover:opacity-100">
          {time}
        </span>
        <span className="italic text-gray-300">
          <span className="font-medium text-gray-100">{message.nick}</span>{' '}
          <MessageContent text={message.content} />
        </span>
      </div>
    )
  }

  if (isSystem) {
    return (
      <div className="group flex items-start px-2 py-0.5 hover:bg-gray-800/30">
        <span className="mr-2 mt-0.5 min-w-[48px] text-right text-xs text-gray-500 opacity-0 group-hover:opacity-100">
          {time}
        </span>
        <span className="text-sm text-gray-500"><MessageContent text={message.content} /></span>
      </div>
    )
  }

  if (isGrouped) {
    return (
      <div className="group flex items-start px-2 py-0.5 hover:bg-gray-800/30">
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
        </div>
      </div>
    )
  }

  return (
    <div className="group mt-3 flex items-start px-2 py-0.5 first:mt-0 hover:bg-gray-800/30">
      {/* Avatar placeholder */}
      <div className="mr-3 mt-0.5 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-indigo-600 text-sm font-bold text-white">
        {message.nick.charAt(0).toUpperCase()}
      </div>

      <div className="flex-1 overflow-hidden">
        <div className="flex items-baseline gap-2">
          <span className="font-medium text-gray-100 hover:underline cursor-pointer">
            {message.nick}
          </span>
          <span className="text-xs text-gray-500">{formatTimeFull(message.timestamp)}</span>
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
      </div>
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
