import {
  Bold,
  CornerUpLeft,
  ImagePlay,
  Italic,
  Loader2,
  Palette,
  Plus,
  Smile,
  Underline,
  X,
  type LucideIcon
} from 'lucide-react'
import { ICON, IconButton } from '../common/IconButton'
import { useState, useRef, useCallback, useEffect, type KeyboardEvent } from 'react'
import type { ReplyTarget } from '../../stores/messageStore'
import type { ChannelUser } from '@shared/types/channel'
import {
  browsing,
  emptyHistory,
  newer,
  older,
  remember,
  textOf,
  type History
} from '@shared/history'
import { IRC_COMMANDS } from '@shared/constants'
import { typingToSend, type TypingEvent } from '@shared/typing'
import { GifPicker } from './GifPicker'
import { EmojiPicker } from './EmojiPicker'
import {
  emojiQuery as emojiOf,
  emojiCandidates,
  emojified,
  withShortcodesReplaced,
  type EmojiEntry
} from '@shared/emoji'
import { useServerStore } from '../../stores/serverStore'
import {
  completionSuffix,
  mentionQuery as mentionOf,
  mentionCandidates as whoCouldBeMeant,
  mentioned
} from '@shared/completion'
import { mark, colourise, IRC_PALETTE, type FormattingMark } from '@shared/formatting'
import { useUIStore } from '../../stores/uiStore'
import { wording } from '../../utils/speak'

/** Composer grows with its content up to this height, then scrolls */
const MAX_COMPOSER_HEIGHT = 320

const COMPLETION_COMMANDS = IRC_COMMANDS.map((name) => `/${name}`)

/**
 * What has been sent where, kept outside the component.
 *
 * A composer is unmounted and remade on every channel change, so state inside
 * it would be history that lasted until you looked away. In memory only and
 * per conversation — see `@shared/history` for why both of those.
 */
const histories = new Map<string, History>()

const historyFor = (key: string): History => histories.get(key) ?? emptyHistory()
const keep = (key: string, history: History): void => void histories.set(key, history)

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
  serverId,
  channel,
  onSend,
  onSendReply,
  replyTarget,
  onCancelReply,
  disabled,
  users = [],
  channels = []
}: MessageComposerProps) {
  const [text, setText] = useState('')
  const [showGifPicker, setShowGifPicker] = useState(false)
  const [showColours, setShowColours] = useState(false)
  const [uploading, setUploading] = useState(false)
  // A file is being dragged over the box — see `uploadFile`
  const [dragging, setDragging] = useState(false)
  const hasFilehost = !!useServerStore((s) => s.filehostUrls[serverId])
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const lastTypingSent = useRef(0)

  /*
   * The lines already sent here, for Up and Down.
   *
   * Per conversation and outside the component, because a composer is
   * unmounted and remade every time you change channel — state inside it would
   * mean history that lasted until you looked away. A module-level map is not
   * elegant; it is the thing that survives.
   *
   * Never written to disk. See `@shared/history`.
   */
  const key = `${serverId}:${channel}`
  const history = useRef<History>(historyFor(key))
  useEffect(() => {
    history.current = historyFor(key)
  }, [key])

  // Tab completion state
  const completionState = useRef<{
    active: boolean
    candidates: string[]
    index: number
    start: number
    prefix: string
  }>({ active: false, candidates: [], index: 0, start: 0, prefix: '' })

  // The mention being typed: what follows a trailing `@`, or null. One rule
  // with the phone — `mentionQuery` in `@shared/completion` — so both offer
  // the same names at the same moment.
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const [mentionIndex, setMentionIndex] = useState(0)
  const mentionRef = useRef<HTMLDivElement>(null)

  const mentionCandidates =
    mentionQuery !== null
      ? whoCouldBeMeant(
          mentionQuery,
          users.map((u) => u.nick)
        )
      : []

  // An emoji name being typed — `:smi` — offered the same way a mention is.
  // See `@shared/emoji`; the phone offers the same names from the same table.
  const [emojiQuery, setEmojiQuery] = useState<string | null>(null)
  const [emojiIndex, setEmojiIndex] = useState(0)
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const emojiMatches: EmojiEntry[] = emojiQuery !== null ? emojiCandidates(emojiQuery) : []
  useEffect(() => {
    setEmojiIndex(0)
  }, [emojiQuery])

  // Reset mention index when candidates change
  useEffect(() => {
    setMentionIndex(0)
  }, [mentionQuery])

  // Switching channel should leave the cursor ready to type, unless something
  // else (a modal, the search box) is deliberately focused.
  useEffect(() => {
    const active = document.activeElement
    const typingElsewhere =
      active instanceof HTMLElement &&
      active !== inputRef.current &&
      (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)
    if (typingElsewhere || disabled) return
    inputRef.current?.focus()
  }, [serverId, channel, disabled])

  // Grow the box to fit what has been typed — one line until the text wraps,
  // then taller line by line, and scrolling once it hits the cap. The
  // measurement is only right for the width it was taken at: text that
  // wrapped in a narrow window unwraps in a wide one, so it is taken again
  // whenever the window changes size.
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    const fit = (): void => {
      el.style.height = 'auto'
      el.style.height = `${Math.min(el.scrollHeight, MAX_COMPOSER_HEIGHT)}px`
    }
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [text])

  /**
   * A picture pasted from the clipboard or dropped on the box.
   *
   * Goes up the same way the button sends a chosen file, and its address
   * goes out as the message. Pasting a screenshot is how everybody shares
   * one on Discord and The Lounge; here a button and a file dialog were the
   * only way, and a screenshot is rarely a file you want to go looking for.
   */
  const uploadFile = useCallback(
    async (file: File) => {
      if (!hasFilehost || uploading || disabled) return
      setUploading(true)
      try {
        const bytes = new Uint8Array(await file.arrayBuffer())
        // The clipboard names a pasted image "image.png"; a bare blob has no name at all
        const name =
          file.name ||
          (file.type.startsWith('image/') ? `pasted.${file.type.split('/')[1]}` : 'upload')
        const result = await window.switchboard.invoke(
          'file:upload-bytes',
          serverId,
          name,
          file.type,
          bytes
        )
        if (result) {
          const { registerUploadFilename } = await import('../../utils/linkify')
          registerUploadFilename(result.url, result.filename)
          onSend(result.url)
        }
      } catch (err) {
        /*
         * Said, not logged.
         *
         * Every refusal the upload can produce is a sentence somebody can act
         * on — the file is too large, the network only takes images, the
         * filehost would not accept your account. All of them went to a
         * console nobody has open, so a failed upload looked exactly like
         * nothing happening.
         */
        useUIStore.getState().addToast({ title: 'That file was not sent', body: wording(err) })
      } finally {
        setUploading(false)
      }
    },
    [hasFilehost, uploading, disabled, serverId, onSend]
  )

  const acceptEmoji = useCallback(
    (entry: EmojiEntry) => {
      const cursor = inputRef.current?.selectionStart ?? text.length
      const finished = emojified(text.slice(0, cursor), entry.emoji)
      setText(finished + text.slice(cursor))
      setEmojiQuery(null)
      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.selectionStart = finished.length
          inputRef.current.selectionEnd = finished.length
          inputRef.current.focus()
        }
      }, 0)
    },
    [text]
  )

  /** Put an emoji from the picker where the cursor is */
  const insertEmoji = useCallback(
    (emoji: string) => {
      const el = inputRef.current
      const at = el?.selectionStart ?? text.length
      const next = text.slice(0, at) + emoji + text.slice(at)
      setText(next)
      setShowEmojiPicker(false)
      setTimeout(() => {
        if (el) {
          el.selectionStart = at + emoji.length
          el.selectionEnd = at + emoji.length
          el.focus()
        }
      }, 0)
    },
    [text]
  )

  const acceptMention = useCallback(
    (nick: string) => {
      const cursor = inputRef.current?.selectionStart ?? text.length
      const finished = mentioned(text.slice(0, cursor), nick)
      setText(finished + text.slice(cursor).trimStart())
      setMentionQuery(null)
      // Focus back and move the cursor to just after the name
      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.selectionStart = finished.length
          inputRef.current.selectionEnd = finished.length
          inputRef.current.focus()
        }
      }, 0)
    },
    [text]
  )

  /**
   * Put a formatting code around the selection.
   *
   * Both clients rendered mIRC formatting and neither could produce any, so
   * bold was something other people's messages had. The selection is restored
   * afterwards so the next keystroke carries on inside the pair rather than
   * at the end of the line.
   */
  const applyMark = useCallback(
    (which: FormattingMark) => {
      const field = inputRef.current
      if (!field) return

      const out = mark(text, field.selectionStart, field.selectionEnd, which)
      setText(out.text)
      // After React has written the new value, or the selection lands in the old
      // one and jumps to the end.
      setTimeout(() => {
        field.focus()
        field.setSelectionRange(out.selectionStart, out.selectionEnd)
      }, 0)
    },
    [text]
  )

  const applyColour = useCallback(
    (colour: number | null) => {
      const field = inputRef.current
      if (!field) return

      const out = colourise(text, field.selectionStart, field.selectionEnd, colour)
      setText(out.text)
      setTimeout(() => {
        field.focus()
        field.setSelectionRange(out.selectionStart, out.selectionEnd)
      }, 0)
    },
    [text]
  )

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      // The shortcuts every client has used since mIRC. Before the mention
      // popup, which does not care about Ctrl.
      if (e.ctrlKey && !e.altKey && !e.metaKey) {
        const shortcut: Record<string, FormattingMark> = {
          b: 'bold',
          i: 'italic',
          u: 'underline',
          s: 'strikethrough'
        }
        const which = shortcut[e.key.toLowerCase()]
        if (which) {
          e.preventDefault()
          applyMark(which)
          return
        }
        // Ctrl+O is "back to plain", the way it has always been
        if (e.key.toLowerCase() === 'o') {
          e.preventDefault()
          applyMark('reset')
          return
        }
      }

      // The emoji list, when one is open: the same keys as the mention list
      if (emojiMatches.length > 0 && emojiQuery !== null) {
        if (e.key === 'ArrowDown') {
          e.preventDefault()
          setEmojiIndex((i) => (i + 1) % emojiMatches.length)
          return
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault()
          setEmojiIndex((i) => (i - 1 + emojiMatches.length) % emojiMatches.length)
          return
        }
        if (e.key === 'Tab' || e.key === 'Enter') {
          e.preventDefault()
          acceptEmoji(emojiMatches[emojiIndex])
          return
        }
        if (e.key === 'Escape') {
          e.preventDefault()
          setEmojiQuery(null)
          return
        }
      }

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
          // `:tada:` goes out as the party popper — see `@shared/emoji`. Not
          // in a command, whose arguments mean what they say.
          const said = text.startsWith('/') ? text.trim() : withShortcodesReplaced(text.trim())
          if (replyTarget && onSendReply) {
            onSendReply(said, replyTarget.id)
          } else {
            onSend(said)
          }
          history.current = remember(history.current, said)
          keep(key, history.current)
          setText('')
          noteTyping('sent')
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

      /*
       * Up and Down: the line you sent before.
       *
       * Only when the caret has nowhere else to go, so a half-written
       * paragraph still moves line by line the way the key otherwise does. The
       * mention popup takes these first — it is handled above.
       */
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        const input = inputRef.current
        const atEdge =
          e.key === 'ArrowUp'
            ? (input?.selectionStart ?? 0) === 0
            : (input?.selectionStart ?? 0) === text.length

        if (!atEdge && !browsing(history.current)) return

        const moved = e.key === 'ArrowUp' ? older(history.current, text) : newer(history.current)
        const wanted = textOf(moved)

        // Nothing to recall — leave the key to the caret rather than eating it
        if (!browsing(moved) && !browsing(history.current)) return

        e.preventDefault()
        history.current = moved
        keep(key, moved)
        setText(wanted)
        // The caret goes to the end, as it does in a shell
        requestAnimationFrame(() => input?.setSelectionRange(wanted.length, wanted.length))
        return
      }

      // Any other key resets completion state
      if (e.key !== 'Shift') {
        completionState.current.active = false
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      text,
      onSend,
      onSendReply,
      replyTarget,
      onCancelReply,
      disabled,
      users,
      channels,
      mentionCandidates,
      mentionQuery,
      mentionIndex,
      acceptMention,
      emojiMatches,
      emojiQuery,
      emojiIndex,
      acceptEmoji,
      applyMark
    ]
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
        const suffix = completionSuffix(cs.start === 0, completion)
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
        candidates = COMPLETION_COMMANDS.filter((cmd) => cmd.toLowerCase().startsWith(prefix))
      } else if (prefix.startsWith('#') || prefix.startsWith('&')) {
        // Channel completion
        candidates = channels.filter((ch) => ch.toLowerCase().startsWith(prefix))
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
      const suffix = completionSuffix(wordStart === 0, completion)
      setText(before + completion + suffix + after.trimStart())
    },
    [text, users, channels]
  )

  /**
   * Put the composer's event to the shared rule and say whatever it returns.
   *
   * The decision lives in `@shared/typing` so the phone answers it the same
   * way — it used to run the notice on a timer instead, and announced `done`
   * twice for every message.
   */
  const noteTyping = useCallback(
    (event: TypingEvent) => {
      if (disabled) return
      const decision = typingToSend(event, lastTypingSent.current, Date.now())
      lastTypingSent.current = decision.lastActiveAt
      if (decision.send) {
        window.switchboard.invoke('message:typing', serverId, channel, decision.send)
      }
    },
    [serverId, channel, disabled]
  )

  const sendTyping = useCallback(() => noteTyping('typed'), [noteTyping])
  const sendTypingDone = useCallback(() => noteTyping('cleared'), [noteTyping])

  return (
    <div
      className={`px-4 pb-6 pt-0 ${dragging ? 'rounded-lg ring-2 ring-inset ring-indigo-500/60' : ''}`}
      // Dropping a file on an Electron window otherwise navigates to it, so
      // the default is always prevented; the upload only happens where the
      // network has somewhere to put it
      onDragOver={(e) => {
        e.preventDefault()
        if (hasFilehost && e.dataTransfer.types.includes('Files')) setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        const file = e.dataTransfer.files[0]
        if (file) void uploadFile(file)
      }}
      title={dragging ? 'Drop to upload' : undefined}
    >
      {/* Reply preview bar */}
      {replyTarget && (
        <div className="mb-1 flex items-center gap-2 rounded-t-lg bg-gray-700/50 px-4 py-2">
          <CornerUpLeft
            size={ICON.sm}
            strokeWidth={2}
            className="shrink-0 text-gray-400"
            aria-hidden="true"
          />
          <span className="text-xs text-gray-400">Replying to</span>
          <span className="text-xs font-medium text-gray-200">{replyTarget.nick}</span>
          <span className="flex-1 truncate text-xs text-gray-500">{replyTarget.content}</span>
          <IconButton
            size="sm"
            surface="raised"
            icon={X}
            label="Cancel reply"
            onClick={onCancelReply}
          />
        </div>
      )}

      <div className={`relative rounded-lg bg-gray-700 ${replyTarget ? 'rounded-t-none' : ''}`}>
        {/* :emoji name being typed */}
        {emojiMatches.length > 0 && emojiQuery !== null && (
          <div className="absolute bottom-full left-0 z-30 mb-2 w-72 overflow-hidden rounded-lg bg-gray-900 py-1 shadow-xl ring-1 ring-gray-700">
            {emojiMatches.map((entry, i) => (
              <button
                key={entry.name}
                onMouseDown={(e) => {
                  e.preventDefault()
                  acceptEmoji(entry)
                }}
                className={`flex w-full items-center gap-3 px-3 py-1.5 text-left text-sm ${
                  i === emojiIndex
                    ? 'bg-indigo-500/30 text-white'
                    : 'text-gray-300 hover:bg-gray-700'
                }`}
              >
                <span className="text-lg">{entry.emoji}</span>
                <span className="font-mono text-xs text-gray-400">:{entry.name}:</span>
              </button>
            ))}
          </div>
        )}

        {/* @mention autocomplete popup */}
        {mentionCandidates.length > 0 && mentionQuery !== null && (
          <div
            ref={mentionRef}
            className="absolute bottom-full left-0 z-30 mb-2 w-72 overflow-hidden rounded-lg bg-gray-900 py-1 shadow-xl ring-1 ring-gray-700"
          >
            {mentionCandidates.map((nick, i) => (
              <button
                key={nick}
                onMouseDown={(e) => {
                  e.preventDefault()
                  acceptMention(nick)
                }}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm ${
                  i === mentionIndex
                    ? 'bg-indigo-500/30 text-white'
                    : 'text-gray-300 hover:bg-gray-700'
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
            <IconButton
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
                  useUIStore
                    .getState()
                    .addToast({ title: 'That file was not sent', body: wording(err) })
                } finally {
                  setUploading(false)
                }
              }}
              disabled={disabled || uploading}
              icon={uploading ? Loader2 : Plus}
              label="Upload a file"
              surface="raised"
              className={`mb-2 ml-2 ${uploading ? '[&>svg]:animate-spin' : ''}`}
            />
          )}

          <textarea
            ref={inputRef}
            value={text}
            onPaste={(e) => {
              const file = e.clipboardData.files[0]
              if (file && hasFilehost) {
                e.preventDefault()
                void uploadFile(file)
              }
            }}
            onChange={(e) => {
              const val = e.target.value
              setText(val)
              completionState.current.active = false

              // A mention or an emoji name being typed, up to the cursor
              const cursor = e.target.selectionStart ?? val.length
              const mention = mentionOf(val.slice(0, cursor))
              setMentionQuery(mention)
              setEmojiQuery(mention === null ? emojiOf(val.slice(0, cursor)) : null)

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
            className="composer-field flex-1 resize-none overflow-y-auto rounded-lg bg-transparent px-4 py-[11px] leading-[22px] text-gray-100 placeholder-gray-500 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
            style={{ maxHeight: `${MAX_COMPOSER_HEIGHT}px` }}
          />

          {/*
            Formatting. The keyboard shortcuts are the ones every client has
            used since mIRC, but a shortcut nobody can see is barely a feature.
          */}
          <div className="mb-2 mr-2 flex items-center gap-0.5">
            {(
              [
                ['bold', Bold, 'Bold (Ctrl+B)'],
                ['italic', Italic, 'Italic (Ctrl+I)'],
                ['underline', Underline, 'Underline (Ctrl+U)']
              ] as [FormattingMark, LucideIcon, string][]
            ).map(([which, icon, title]) => (
              <IconButton
                key={which}
                icon={icon}
                label={title}
                surface="raised"
                disabled={disabled}
                onClick={() => applyMark(which)}
              />
            ))}
            <IconButton
              icon={Palette}
              label="Colour"
              surface="raised"
              disabled={disabled}
              active={showColours}
              onClick={() => setShowColours(!showColours)}
            />
            {/* Emoji picker, for the face you know and cannot name */}
            <IconButton
              icon={Smile}
              label="Emoji"
              surface="raised"
              disabled={disabled}
              active={showEmojiPicker}
              onClick={() => setShowEmojiPicker(!showEmojiPicker)}
            />
            {/* GIF button */}
            <IconButton
              icon={ImagePlay}
              label="Search GIFs"
              surface="raised"
              disabled={disabled}
              active={showGifPicker}
              onClick={() => setShowGifPicker(!showGifPicker)}
            />
          </div>
        </div>

        {/*
          The sixteen every client agrees on. The extended palette exists but
          nothing renders it consistently, and a colour nobody else can see is
          a message nobody else can read.
        */}
        {showColours && (
          <div className="absolute bottom-full right-2 mb-2 flex flex-wrap gap-1 rounded-lg bg-gray-900 p-2 shadow-xl ring-1 ring-gray-700">
            {IRC_PALETTE.slice(0, 16).map((colour, index) => (
              <button
                key={index}
                onClick={() => {
                  applyColour(index)
                  setShowColours(false)
                }}
                title={`Colour ${index}`}
                className="h-5 w-5 rounded ring-1 ring-gray-700 hover:ring-gray-400"
                style={{ backgroundColor: colour }}
              />
            ))}
            <button
              onClick={() => {
                applyColour(null)
                setShowColours(false)
              }}
              className="rounded px-2 text-xs text-gray-400 hover:text-gray-100"
            >
              None
            </button>
          </div>
        )}

        {showEmojiPicker && (
          <EmojiPicker onSelect={insertEmoji} onClose={() => setShowEmojiPicker(false)} />
        )}

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
