import { useState, useRef, useCallback, useEffect, type KeyboardEvent } from 'react'
import type { ReplyTarget } from '../../stores/messageStore'
import type { ChannelUser } from '@shared/types/channel'
import { TYPING_THROTTLE_MS } from '@shared/constants'

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

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
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
    [text, onSend, onSendReply, replyTarget, onCancelReply, disabled, users, channels]
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

      <div className={`rounded-lg bg-gray-700 ${replyTarget ? 'rounded-t-none' : ''}`}>
        <textarea
          ref={inputRef}
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            handleInput()
            completionState.current.active = false
            if (e.target.value.trim()) {
              sendTyping()
            } else {
              sendTypingDone()
            }
          }}
          onKeyDown={handleKeyDown}
          placeholder={disabled ? 'Not connected' : `Message ${channel}`}
          disabled={disabled}
          rows={1}
          className="w-full resize-none bg-transparent px-4 py-3 text-gray-100 placeholder-gray-400 outline-none disabled:cursor-not-allowed disabled:opacity-50"
          style={{ maxHeight: '200px' }}
        />
      </div>
    </div>
  )
}
