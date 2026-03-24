import { useState, useRef, useCallback, useEffect, type KeyboardEvent } from 'react'
import type { ReplyTarget } from '../../stores/messageStore'
import type { ChannelUser } from '@shared/types/channel'
import { TYPING_THROTTLE_MS } from '@shared/constants'
import { GifPicker } from './GifPicker'
import { useServerStore } from '../../stores/serverStore'

const IRC_COMMANDS = [
  '/me', '/join', '/part', '/nick', '/msg', '/whois', '/kick',
  '/topic', '/mode', '/notice', '/quit', '/away', '/back'
]

interface MessageComposerProps {
  serverId: string
  channel: string
  onSend: (text: string) => void
  onSendReply?: (text: string, replyTo: string) => void
  replyTarget?: ReplyTarget | null
  onCancelReply?: () => void
  disabled?: boolean
  /** Users in current channel for nick completion */
  users?: ChannelUser[]
  /** Channels on current server for channel completion */
  channels?: string[]
}

export function MessageComposer({
  serverId, channel, onSend, onSendReply, replyTarget, onCancelReply,
  disabled, users = [], channels = []
}: MessageComposerProps) {
  const [text, setText] = useState('')
  const [showGifPicker, setShowGifPicker] = useState(false)
  const [uploading, setUploading] = useState(false)
  const hasFilehost = !!useServerStore((s) => s.filehostUrls[serverId])
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const lastTypingSent = useRef(0)

  // Tab completion state
  const completionState = useRef<{
    active: boolean
    candidates: string[]
    index: number
    start: number
    prefix: string
  }>({ active: false, candidates: [], index: 0, start: 0, prefix: '' })

  // @mention autocomplete state
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const [mentionStart, setMentionStart] = useState(0)
  const [mentionIndex, setMentionIndex] = useState(0)
  const mentionRef = useRef<HTMLDivElement>(null)

  const mentionCandidates = mentionQuery !== null
    ? users
        .map((u) => u.nick)
        .filter((nick) => nick.toLowerCase().startsWith(mentionQuery.toLowerCase()))
        .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
        .slice(0, 10)
    : []

  // Reset mention index when candidates change
  useEffect(() => {
    setMentionIndex(0)
  }, [mentionQuery])

  const acceptMention = useCallback((nick: string) => {
    const before = text.slice(0, mentionStart)
    const after = text.slice(inputRef.current?.selectionStart || text.length)
    setText(before + nick + ' ' + after.trimStart())
    setMentionQuery(null)
    // Focus back and move cursor after inserted nick
    setTimeout(() => {
      if (inputRef.current) {
        const pos = mentionStart + nick.length + 1
        inputRef.current.selectionStart = pos
        inputRef.current.selectionEnd = pos
        inputRef.current.focus()
      }
    }, 0)
  }, [text, mentionStart])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      // Handle mention popup navigation
      if (mentionCandidates.length > 0 && mentionQuery !== null) {
        if (e.key === 'ArrowDown') {
          e.preventDefault()
          setMentionIndex((i) => (i + 1) % mentionCandidates.length)
          return
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault()
          setMentionIndex((i) => (i - 1 + mentionCandidates.length) % mentionCandidates.length)
          return
        }
        if (e.key === 'Tab' || e.key === 'Enter') {
          e.preventDefault()
          acceptMention(mentionCandidates[mentionIndex])
          return
        }
        if (e.key === 'Escape') {
          e.preventDefault()
          setMentionQuery(null)
          return
        }
      }

      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        if (text.trim() && !disabled) {
          if (replyTarget && onSendReply) {
            onSendReply(text.trim(), replyTarget.id)
          } else {
            onSend(text.trim())
          }
          setText('')
          sendTypingDone()
          onCancelReply?.()
          completionState.current.active = false
          setMentionQuery(null)
        }
        return
      }

      if (e.key === 'Escape' && replyTarget) {
        onCancelReply?.()
        return
      }

      if (e.key === 'Tab') {
        e.preventDefault()
        handleTabCompletion(e.shiftKey)
        return
      }

      // Any other key resets completion state
      if (e.key !== 'Shift') {
        completionState.current.active = false
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [text, onSend, onSendReply, replyTarget, onCancelReply, disabled, users, channels, mentionCandidates, mentionQuery, mentionIndex, acceptMention]
  )

  const handleTabCompletion = useCallback(
    (reverse: boolean) => {
      const cs = completionState.current
      const input = inputRef.current
      if (!input) return

      if (cs.active && cs.candidates.length > 0) {
        // Cycle through candidates
        cs.index = reverse
          ? (cs.index - 1 + cs.candidates.length) % cs.candidates.length
          : (cs.index + 1) % cs.candidates.length

        const completion = cs.candidates[cs.index]
        const before = text.slice(0, cs.start)
        const after = text.slice(input.selectionStart || text.length)
        const suffix = cs.start === 0 && !completion.startsWith('/') && !completion.startsWith('#')
          ? ': '
          : ' '
        const newText = before + completion + suffix + after.trimStart()
        setText(newText)
        return
      }

      // Start new completion
      const cursorPos = input.selectionStart || text.length
      const beforeCursor = text.slice(0, cursorPos)

      // Find the word being completed
      const lastSpace = beforeCursor.lastIndexOf(' ')
      const wordStart = lastSpace + 1
      const prefix = beforeCursor.slice(wordStart).toLowerCase()

      if (!prefix) return

      let candidates: string[]

      if (prefix.startsWith('/')) {
        // Command completion
        candidates = IRC_COMMANDS.filter((cmd) =>
          cmd.toLowerCase().startsWith(prefix)
        )
      } else if (prefix.startsWith('#') || prefix.startsWith('&')) {
        // Channel completion
        candidates = channels.filter((ch) =>
          ch.toLowerCase().startsWith(prefix)
        )
      } else {
        // Nick completion
        candidates = users
          .map((u) => u.nick)
          .filter((nick) => nick.toLowerCase().startsWith(prefix))
          .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
      }

      if (candidates.length === 0) return

      cs.active = true
      cs.candidates = candidates
      cs.index = 0
      cs.start = wordStart
      cs.prefix = prefix

      const completion = candidates[0]
      const before = text.slice(0, wordStart)
      const after = text.slice(cursorPos)
      const suffix = wordStart === 0 && !completion.startsWith('/') && !completion.startsWith('#')
        ? ': '
        : ' '
      setText(before + completion + suffix + after.trimStart())
    },
    [text, users, channels]
  )

  const sendTyping = useCallback(() => {
    if (disabled) return
    const now = Date.now()
    if (now - lastTypingSent.current > TYPING_THROTTLE_MS) {
      lastTypingSent.current = now
      window.switchboard.invoke('message:typing', serverId, channel, 'active')
    }
  }, [serverId, channel, disabled])

  const sendTypingDone = useCallback(() => {
    if (disabled) return
    // Only send done if we actually sent an active recently
    if (lastTypingSent.current > 0) {
      lastTypingSent.current = 0
      window.switchboard.invoke('message:typing', serverId, channel, 'done')
    }
  }, [serverId, channel, disabled])

  const handleInput = useCallback(() => {
    if (inputRef.current) {
      inputRef.current.style.height = 'auto'
      inputRef.current.style.height = Math.min(inputRef.current.scrollHeight, 200) + 'px'
    }
  }, [])

  return (
    <div className="px-4 pb-6 pt-0">
      {/* Reply preview bar */}
      {replyTarget && (
        <div className="mb-1 flex items-center gap-2 rounded-t-lg bg-gray-700/50 px-4 py-2">
          <svg className="h-4 w-4 flex-shrink-0 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9 17l-5-5 5-5" />
            <path d="M4 12h12a4 4 0 0 1 0 8h-1" />
          </svg>
          <span className="text-xs text-gray-400">Replying to</span>
          <span className="text-xs font-medium text-gray-200">{replyTarget.nick}</span>
          <span className="flex-1 truncate text-xs text-gray-500">{replyTarget.content}</span>
          <button
            onClick={onCancelReply}
            className="flex-shrink-0 rounded p-0.5 text-gray-400 hover:bg-gray-600 hover:text-gray-200"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
            </svg>
          </button>
        </div>
      )}

      <div className={`relative rounded-lg bg-gray-700 ${replyTarget ? 'rounded-t-none' : ''}`}>
        {/* @mention autocomplete popup */}
        {mentionCandidates.length > 0 && mentionQuery !== null && (
          <div
            ref={mentionRef}
            className="absolute bottom-full left-0 z-20 mb-1 w-64 overflow-hidden rounded-lg border border-gray-600 bg-gray-800 py-1 shadow-xl"
          >
            {mentionCandidates.map((nick, i) => (
              <button
                key={nick}
                onMouseDown={(e) => {
                  e.preventDefault()
                  acceptMention(nick)
                }}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm ${
                  i === mentionIndex ? 'bg-indigo-500/30 text-white' : 'text-gray-300 hover:bg-gray-700'
                }`}
              >
                <span className="font-medium">{nick}</span>
              </button>
            ))}
          </div>
        )}

        <div className="flex items-end">
          {/* Upload button */}
          {hasFilehost && (
            <button
              onClick={async () => {
                if (uploading || disabled) return
                setUploading(true)
                try {
                  const result = await window.switchboard.invoke('file:upload', serverId)
                  if (result) {
                    const { registerUploadFilename } = await import('../../utils/linkify')
                    registerUploadFilename(result.url, result.filename)
                    onSend(result.url)
                  }
                } catch (err) {
                  console.error('File upload failed:', err)
                } finally {
                  setUploading(false)
                }
              }}
              disabled={disabled || uploading}
              className="mb-2 ml-2 rounded p-1.5 text-gray-400 hover:bg-gray-600 hover:text-gray-200 disabled:opacity-50"
              title="Upload a file"
            >
              {uploading ? (
                <svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
                </svg>
              ) : (
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              )}
            </button>
          )}

          <textarea
            ref={inputRef}
            value={text}
            onChange={(e) => {
              const val = e.target.value
              setText(val)
              handleInput()
              completionState.current.active = false

              // Detect @mention query
              const cursor = e.target.selectionStart || val.length
              const beforeCursor = val.slice(0, cursor)
              const atMatch = beforeCursor.match(/@(\w*)$/)
              if (atMatch) {
                setMentionQuery(atMatch[1])
                setMentionStart(cursor - atMatch[1].length)
              } else {
                setMentionQuery(null)
              }

              if (val.trim()) {
                sendTyping()
              } else {
                sendTypingDone()
              }
            }}
            onKeyDown={handleKeyDown}
            placeholder={disabled ? 'Not connected' : `Message ${channel}`}
            disabled={disabled}
            rows={1}
            className="flex-1 resize-none bg-transparent px-4 py-3 text-gray-100 placeholder-gray-400 outline-none disabled:cursor-not-allowed disabled:opacity-50"
            style={{ maxHeight: '200px' }}
          />

          {/* GIF button */}
          <button
            onClick={() => setShowGifPicker(!showGifPicker)}
            disabled={disabled}
            className="mb-2 mr-2 rounded p-1.5 text-gray-400 hover:bg-gray-600 hover:text-gray-200 disabled:opacity-50"
            title="Search GIFs"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V5h14v14zm-7-2h2v-4h-2v2h-2v-2H8v4h2v-2h2v2zm4-4h2v-2h-2v2zm0 4h2v-2h-2v2z" />
            </svg>
          </button>
        </div>

        {/* GIF picker panel */}
        {showGifPicker && (
          <GifPicker
            onSelect={(url) => {
              onSend(url)
              setShowGifPicker(false)
            }}
            onClose={() => setShowGifPicker(false)}
          />
        )}
      </div>
    </div>
  )
}
