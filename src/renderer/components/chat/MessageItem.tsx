import { useState, useCallback, useRef, useEffect } from 'react'
import type { ChatMessage } from '@shared/types/message'
import { MessageContent } from './MessageContent'
import { useMessageStore } from '../../stores/messageStore'
import { useUIStore } from '../../stores/uiStore'
import { useServerStore } from '../../stores/serverStore'

interface MessageItemProps {
  message: ChatMessage
  prevMessage: ChatMessage | null
  onReply?: (message: ChatMessage) => void
}

export function MessageItem({ message, prevMessage, onReply }: MessageItemProps) {
  const userAvatars = useServerStore((s) => s.userAvatars)
  const avatarUrl = userAvatars[`${message.serverId}:${message.nick.toLowerCase()}`] ?? null

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
            <NickWithPopup nick={message.nick} serverId={message.serverId} className="font-medium text-gray-100" />{' '}
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
      {/* Avatar */}
      <MessageAvatar nick={message.nick} avatarUrl={avatarUrl} />

      <div className="flex-1 overflow-hidden">
        {/* Reply preview */}
        {message.replyTo && (
          <ReplyPreview serverId={message.serverId} channel={message.channel} msgid={message.replyTo} />
        )}

        <div className="flex items-baseline gap-2">
          <NickWithPopup nick={message.nick} serverId={message.serverId} className="font-medium text-gray-100 hover:underline cursor-pointer" />
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

const QUICK_EMOJIS = ['👍', '❤️', '😂', '🎉', '😢', '🤔', '👀', '🔥']

/** Hover actions for a message (react, reply, delete) */
function MessageActions({ message, onReply }: { message: ChatMessage; onReply?: (message: ChatMessage) => void }) {
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const pickerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!showEmojiPicker) return
    const handleClick = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setShowEmojiPicker(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [showEmojiPicker])

  if (message.type === 'system') return null

  const handleReact = (emoji: string) => {
    window.switchboard.invoke('message:react', message.serverId, message.channel, message.id, emoji)
    setShowEmojiPicker(false)
  }

  const handleRedact = () => {
    // Optimistic removal from UI immediately
    useMessageStore.getState().removeMessage(message.serverId, message.channel, message.id)
    // Send REDACT to server and delete from local DB
    window.switchboard.invoke('message:redact', message.serverId, message.channel, message.id)
  }

  return (
    <div className="absolute -top-3 right-2 z-10 flex gap-0.5 rounded border border-gray-700 bg-gray-800 opacity-0 shadow-sm transition-opacity group-hover:opacity-100">
      {/* Delete confirmation popup */}
      {showDeleteConfirm && (
        <div className="absolute -top-1 right-0 z-30 -translate-y-full rounded-lg border border-gray-700 bg-gray-800 p-3 shadow-xl">
          <p className="mb-2 whitespace-nowrap text-sm text-gray-300">Delete this message?</p>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setShowDeleteConfirm(false)}
              className="rounded px-3 py-1 text-xs text-gray-400 hover:bg-gray-700 hover:text-gray-200"
            >
              Cancel
            </button>
            <button
              onClick={() => { handleRedact(); setShowDeleteConfirm(false) }}
              className="rounded bg-red-600 px-3 py-1 text-xs text-white hover:bg-red-500"
            >
              Delete
            </button>
          </div>
        </div>
      )}

      {/* React */}
      <div className="relative" ref={pickerRef}>
        <button
          onClick={() => setShowEmojiPicker(!showEmojiPicker)}
          className="rounded px-2 py-1 text-gray-400 hover:bg-gray-700 hover:text-gray-200"
          title="Add reaction"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <path d="M8 14s1.5 2 4 2 4-2 4-2" />
            <line x1="9" y1="9" x2="9.01" y2="9" />
            <line x1="15" y1="9" x2="15.01" y2="9" />
          </svg>
        </button>

        {showEmojiPicker && (
          <div className="absolute -top-1 right-0 z-20 -translate-y-full rounded-lg border border-gray-700 bg-gray-800 p-2 shadow-xl">
            <div className="flex gap-1">
              {QUICK_EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  onClick={() => handleReact(emoji)}
                  className="rounded p-1 text-lg hover:bg-gray-700"
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Reply */}
      {onReply && (
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
      )}

      {/* Delete (redact) */}
      <button
        onClick={() => setShowDeleteConfirm(true)}
        className="rounded px-2 py-1 text-gray-400 hover:bg-red-900/50 hover:text-red-400"
        title="Delete message"
      >
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M3 6h18" />
          <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
        </svg>
      </button>
    </div>
  )
}

/** Nick with WHOIS popup on hover */
function NickWithPopup({ nick, serverId, className }: { nick: string; serverId: string; className?: string }) {
  const popupWhoisData = useUIStore((s) =>
    s.popupWhoisData?.nick.toLowerCase() === nick.toLowerCase() ? s.popupWhoisData : null
  )
  const userAvatars = useServerStore((s) => s.userAvatars)
  const nickAvatarUrl = userAvatars[`${serverId}:${nick.toLowerCase()}`] ?? null
  const [showPopup, setShowPopup] = useState(false)
  const [popupPos, setPopupPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const [fetched, setFetched] = useState(false)
  const hoverTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hideTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  const fetchWhois = useCallback(() => {
    if (fetched) return
    setFetched(true)
    useUIStore.getState().setPopupWhoisNick(nick)
    window.switchboard.invoke('user:whois', serverId, nick)
  }, [serverId, nick, fetched])

  const handleMouseEnter = (e: React.MouseEvent) => {
    if (hideTimeout.current) {
      clearTimeout(hideTimeout.current)
      hideTimeout.current = null
    }
    hoverTimeout.current = setTimeout(() => {
      const rect = (e.target as HTMLElement).getBoundingClientRect()
      setPopupPos({ x: rect.left, y: rect.bottom + 4 })
      setShowPopup(true)
      fetchWhois()
    }, 400)
  }

  const handleMouseLeave = () => {
    if (hoverTimeout.current) {
      clearTimeout(hoverTimeout.current)
      hoverTimeout.current = null
    }
    hideTimeout.current = setTimeout(() => {
      setShowPopup(false)
    }, 300)
  }

  const handlePopupEnter = () => {
    if (hideTimeout.current) {
      clearTimeout(hideTimeout.current)
      hideTimeout.current = null
    }
  }

  const handlePopupLeave = () => {
    hideTimeout.current = setTimeout(() => {
      setShowPopup(false)
    }, 200)
  }

  return (
    <>
      <span
        className={className}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        {nick}
      </span>

      {showPopup && (
        <div
          className="fixed z-50 w-72 rounded-lg border border-gray-700 bg-gray-800 p-3 shadow-xl"
          style={{ left: popupPos.x, top: popupPos.y }}
          onMouseEnter={handlePopupEnter}
          onMouseLeave={handlePopupLeave}
        >
          {popupWhoisData ? (
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <WhoisAvatar nick={popupWhoisData.nick} avatarUrl={nickAvatarUrl} />
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="font-semibold text-gray-100">{popupWhoisData.nick}</span>
                    {popupWhoisData.isOperator && (
                      <span className="rounded bg-red-500/20 px-1 py-0.5 text-[10px] font-semibold text-red-400">OPER</span>
                    )}
                    {popupWhoisData.isBot && (
                      <span className="rounded bg-indigo-500/20 px-1 py-0.5 text-[10px] font-semibold text-indigo-400">BOT</span>
                    )}
                  </div>
                  {popupWhoisData.user && popupWhoisData.host && (
                    <div className="truncate text-xs text-gray-500">{popupWhoisData.user}@{popupWhoisData.host}</div>
                  )}
                </div>
              </div>

              {popupWhoisData.realname && (
                <div className="text-sm text-gray-300">{popupWhoisData.realname}</div>
              )}

              <div className="space-y-1 border-t border-gray-700 pt-2 text-xs">
                {popupWhoisData.account && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">Account</span>
                    <span className="text-gray-300">{popupWhoisData.account}</span>
                  </div>
                )}
                {popupWhoisData.server && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">Server</span>
                    <span className="truncate ml-2 text-gray-300">{popupWhoisData.server}</span>
                  </div>
                )}
                {popupWhoisData.idle && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">Idle</span>
                    <span className="text-gray-300">{formatIdleTime(parseInt(popupWhoisData.idle))}</span>
                  </div>
                )}
                {popupWhoisData.channels && (
                  <div>
                    <span className="text-gray-500">Channels</span>
                    <div className="mt-0.5 text-gray-300 break-words">{popupWhoisData.channels}</div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm text-gray-400">
              <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
              </svg>
              Loading...
            </div>
          )}
        </div>
      )}
    </>
  )
}

function WhoisAvatar({ nick, avatarUrl }: { nick: string; avatarUrl: string | null }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => { setFailed(false) }, [avatarUrl])

  if (avatarUrl && !failed) {
    return (
      <img
        src={avatarUrl}
        alt={nick}
        referrerPolicy="no-referrer"
        crossOrigin="anonymous"
        className="h-10 w-10 shrink-0 rounded-full object-cover"
        onError={() => setFailed(true)}
      />
    )
  }
  return (
    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-sm font-bold text-white">
      {nick.charAt(0).toUpperCase()}
    </div>
  )
}

function MessageAvatar({ nick, avatarUrl }: { nick: string; avatarUrl: string | null }) {
  const [failed, setFailed] = useState(false)

  useEffect(() => { setFailed(false) }, [avatarUrl])

  if (avatarUrl && !failed) {
    return (
      <img
        src={avatarUrl}
        alt={nick}
        referrerPolicy="no-referrer"
        crossOrigin="anonymous"
        className="mr-3 mt-0.5 h-10 w-10 flex-shrink-0 rounded-full object-cover"
        onError={() => setFailed(true)}
      />
    )
  }

  return (
    <div className="mr-3 mt-0.5 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-indigo-600 text-sm font-bold text-white">
      {nick.charAt(0).toUpperCase()}
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
    const hour12 = useUIStore.getState().timeFormat === '12h'
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12 })
  } catch {
    return ''
  }
}

function formatTimeFull(iso: string): string {
  try {
    const d = new Date(iso)
    const hour12 = useUIStore.getState().timeFormat === '12h'
    const timeOpts: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', hour12 }
    const today = new Date()
    if (d.toDateString() === today.toDateString()) {
      return 'Today at ' + d.toLocaleTimeString([], timeOpts)
    }
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) +
      ' at ' + d.toLocaleTimeString([], timeOpts)
  } catch {
    return ''
  }
}

function formatIdleTime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`
  return `${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h`
}

function timeDiffMinutes(a: string, b: string): number {
  try {
    return (new Date(b).getTime() - new Date(a).getTime()) / 60000
  } catch {
    return Infinity
  }
}
