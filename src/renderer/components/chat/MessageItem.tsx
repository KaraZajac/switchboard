import { CornerUpLeft, Pencil, SmilePlus, Trash2 } from 'lucide-react'
import { IconButton } from '../common/IconButton'
import { useState, useCallback, useRef, useEffect } from 'react'
import type { ChatMessage } from '@shared/types/message'
import { canEdit } from '@shared/editing'
import { ProfileCard } from '../user/ProfileCard'
import { MessageContent } from './MessageContent'
import { useMessageStore } from '../../stores/messageStore'
import { useUIStore } from '../../stores/uiStore'
import { useServerStore } from '../../stores/serverStore'
import { useUserStore } from '../../stores/userStore'
import { canModerate } from '@shared/powers'
import { nickStyle } from '../../utils/nickColor'
import { displayNameFor, metadataColor } from '@shared/types/metadata'
import { mentionsYou } from '@shared/mentions'
import { speak } from '../../utils/speak'

interface MessageItemProps {
  message: ChatMessage
  prevMessage: ChatMessage | null
  onReply?: (message: ChatMessage) => void
}

export function MessageItem({ message, prevMessage, onReply }: MessageItemProps) {
  const userMetadata = useServerStore((s) => s.userMetadata)
  const senderMetadata = userMetadata[`${message.serverId}:${message.nick.toLowerCase()}`]
  const avatarUrl = senderMetadata?.avatar ?? null
  const currentNick = useServerStore((s) => s.currentNick[message.serverId] ?? '')
  const compactMode = useUIStore((s) => s.compactMode)

  /*
   * Which message is being amended is the window's business, not this one's.
   *
   * The composer starts an edit when Up is pressed on an empty box, and it has
   * no way to reach into the message it means. So the id lives in the store
   * and each message asks whether it is the one — which also means starting a
   * second edit closes the first, for free.
   */
  const editingMessageId = useUIStore((s) => s.editingMessageId)
  const setEditingMessage = useUIStore((s) => s.setEditingMessage)
  const editing = editingMessageId === message.id
  const [editText, setEditText] = useState('')

  // Opened from somewhere else — the Up key — so the box has to be filled from
  // here rather than by whoever asked.
  useEffect(() => {
    if (editing) setEditText(message.content)
    // The content is deliberately not a dependency: an edit arriving from
    // another device while you are typing must not wipe what you have written.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing])

  const isAction = message.type === 'action'
  const isNotice = message.type === 'notice'
  const isSystem = message.type === 'system'
  const isDeleted = message.deleted === true
  const isOwn = currentNick.toLowerCase() === message.nick.toLowerCase()
  const isEdited = !!message.editedAt

  // The same rule the notifier and the badge use, and the same rule the phone
  // uses — a line that lights up one of them has to light up all three.
  const highlightWords = useServerStore((s) => s.highlightWords)
  const isMention =
    !isOwn &&
    message.type === 'privmsg' &&
    mentionsYou(message.content, currentNick, highlightWords)
  const mentionBg = isMention ? 'bg-yellow-500/8 border-l-2 border-yellow-500/50' : ''

  const handleEditStart = () => {
    setEditText(message.content)
    setEditingMessage(message.id)
  }

  const handleEditSave = () => {
    const trimmed = editText.trim()
    if (trimmed && trimmed !== message.content) {
      // Optimistic update
      useMessageStore
        .getState()
        .editMessage(
          message.serverId,
          message.channel,
          message.id,
          trimmed,
          new Date().toISOString()
        )
      speak(
        window.switchboard.invoke(
          'message:edit',
          message.serverId,
          message.channel,
          message.id,
          trimmed
        ),
        'That edit did not go'
      )
    }
    setEditingMessage(null)
  }

  const handleEditCancel = () => {
    setEditingMessage(null)
  }

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

  if (isDeleted) {
    return (
      <div className="flex items-start px-2 py-0.5">
        <span className="mt-0.5 w-14 shrink-0 overflow-hidden pr-2 text-right text-[11px] leading-4 whitespace-nowrap text-gray-500 opacity-0">
          {time}
        </span>
        <span className="text-sm italic text-gray-600">this message was deleted</span>
      </div>
    )
  }

  if (isAction) {
    return (
      <div className="group relative flex items-start px-2 py-0.5 hover:bg-gray-700/25">
        <span className="mt-0.5 w-14 shrink-0 overflow-hidden pr-2 text-right text-[11px] leading-4 whitespace-nowrap text-gray-500 opacity-0 group-hover:opacity-100">
          {time}
        </span>
        <div className="flex-1">
          <span className="italic text-gray-300">
            <NickWithPopup
              nick={message.nick}
              serverId={message.serverId}
              className="font-medium text-gray-100"
            />{' '}
            <MessageContent text={message.content} />
          </span>
          <MessageActions
            message={message}
            onReply={onReply}
            isOwn={isOwn}
            onEdit={handleEditStart}
          />
        </div>
      </div>
    )
  }

  if (isSystem) {
    return (
      <div className="group relative flex items-start px-2 py-0.5 hover:bg-gray-700/25">
        <span className="mt-0.5 w-14 shrink-0 overflow-hidden pr-2 text-right text-[11px] leading-4 whitespace-nowrap text-gray-500 opacity-0 group-hover:opacity-100">
          {time}
        </span>
        <span className="text-sm text-gray-500">
          <MessageContent text={message.content} />
        </span>
      </div>
    )
  }

  if (isGrouped) {
    return (
      /*
        No padding of its own, so a run from one person is evenly spaced.
        A line box already carries the leading, so `py-0.5` added four pixels
        *between* messages that a wrap does not get between its own lines —
        measured here as 25px from one message to the next against 21px inside
        a wrapped one. Small, and enough to make the wrapped message look like
        it belongs to something else. The phone had the same fault the other
        way round, for a different reason.
      */
      <div className={`group relative flex items-start px-2 hover:bg-gray-700/25 ${mentionBg}`}>
        <span className="mt-0.5 w-14 shrink-0 overflow-hidden pr-2 text-right text-[11px] leading-4 whitespace-nowrap text-gray-500 opacity-0 group-hover:opacity-100">
          {time}
        </span>
        <div className="flex-1">
          {editing ? (
            <EditInput
              text={editText}
              onChange={setEditText}
              onSave={handleEditSave}
              onCancel={handleEditCancel}
            />
          ) : (
            <span className={isNotice ? 'text-gray-400' : 'text-gray-200'}>
              <MessageContent text={message.content} highlightNick={currentNick} />
              {isEdited && <span className="ml-1 text-[10px] text-gray-500">(edited)</span>}
            </span>
          )}
          {Object.keys(message.reactions).length > 0 && <Reactions message={message} />}
          <MessageActions
            message={message}
            onReply={onReply}
            isOwn={isOwn}
            onEdit={handleEditStart}
          />
        </div>
      </div>
    )
  }

  if (compactMode) {
    return (
      <div
        className={`group relative flex items-start px-2 py-0.5 hover:bg-gray-700/25 ${mentionBg}`}
      >
        <span className="mt-0.5 w-14 shrink-0 overflow-hidden pr-2 text-right text-[11px] leading-4 whitespace-nowrap text-gray-500">
          {time}
        </span>
        <div className="flex-1 overflow-hidden">
          {message.replyTo && (
            <ReplyPreview
              serverId={message.serverId}
              channel={message.channel}
              msgid={message.replyTo}
              at={message.timestamp}
              compact
            />
          )}
          <span>
            <NickWithPopup
              nick={message.nick}
              serverId={message.serverId}
              className="font-medium text-gray-100 hover:underline cursor-pointer"
            />
            <span className="mx-1 text-gray-200">
              {editing ? (
                <EditInput
                  text={editText}
                  onChange={setEditText}
                  onSave={handleEditSave}
                  onCancel={handleEditCancel}
                />
              ) : (
                <span className={isNotice ? 'text-gray-400' : ''}>
                  <MessageContent text={message.content} highlightNick={currentNick} />
                  {isEdited && <span className="ml-1 text-[10px] text-gray-500">(edited)</span>}
                </span>
              )}
            </span>
          </span>
          {Object.keys(message.reactions).length > 0 && <Reactions message={message} />}
          <MessageActions
            message={message}
            onReply={onReply}
            isOwn={isOwn}
            onEdit={handleEditStart}
          />
        </div>
      </div>
    )
  }

  return (
    <div
      /*
        `mt-3` separates this person from the last one, and `pt-0.5` sits the
        name row off the top of it — but nothing below, so the first line of a
        run and the grouped lines under it are the same distance apart as two
        lines of a wrap. See the grouped branch above.
      */
      className={`group relative mt-3 flex flex-col px-2 pt-0.5 first:mt-0 hover:bg-gray-700/25 ${mentionBg}`}
    >
      {/*
        The quote is a row of its own, above the avatar rather than beside it.
        Inside the content column its corner had nothing to turn out of — it
        floated in the middle of the line with the avatar stranded to its left.
        Out here it starts in the avatar's own column and turns right, which is
        the whole point of drawing a corner.
      */}
      {message.replyTo && (
        <ReplyPreview
          serverId={message.serverId}
          channel={message.channel}
          msgid={message.replyTo}
          at={message.timestamp}
        />
      )}

      <div className="flex items-start">
        {/* Avatar */}
        <MessageAvatar nick={message.nick} avatarUrl={avatarUrl} />

        <div className="flex-1 overflow-hidden">
          <div className="flex items-baseline gap-2">
            <NickWithPopup
              nick={message.nick}
              serverId={message.serverId}
              className="font-medium text-gray-100 hover:underline cursor-pointer"
            />
            <span className="text-xs text-gray-500">{formatTimeFull(message.timestamp)}</span>
            {message.oper !== null && message.oper !== undefined && (
              <span
                className="rounded bg-yellow-500/20 px-1.5 py-0.5 text-[10px] font-medium text-gray-100"
                title={
                  message.oper
                    ? `The server says this is a network operator (${message.oper})`
                    : 'The server says this is a network operator'
                }
              >
                operator
              </span>
            )}
            {message.relayedBy !== null && message.relayedBy !== undefined && (
              <span
                className="rounded bg-blue-400/20 px-1.5 py-0.5 text-[10px] font-medium text-gray-100"
                title={
                  message.relayedBy
                    ? `Carried in from somewhere else by ${message.relayedBy}`
                    : 'Carried in from somewhere else'
                }
              >
                bridged
              </span>
            )}
            {message.channelContext && (
              <span className="rounded bg-gray-700/50 px-1.5 py-0.5 text-[10px] text-gray-400">
                from {message.channelContext}
              </span>
            )}
            {message.pending && <span className="text-xs text-gray-600">sending...</span>}
          </div>
          {editing ? (
            <EditInput
              text={editText}
              onChange={setEditText}
              onSave={handleEditSave}
              onCancel={handleEditCancel}
            />
          ) : (
            <div className={isNotice ? 'text-gray-400' : 'text-gray-200'}>
              <MessageContent text={message.content} highlightNick={currentNick} />
              {isEdited && <span className="ml-1 text-[10px] text-gray-500">(edited)</span>}
            </div>
          )}
          {Object.keys(message.reactions).length > 0 && <Reactions message={message} />}
          <MessageActions
            message={message}
            onReply={onReply}
            isOwn={isOwn}
            onEdit={handleEditStart}
          />
        </div>
      </div>
    </div>
  )
}

/** Inline edit input */
function EditInput({
  text,
  onChange,
  onSave,
  onCancel
}: {
  text: string
  onChange: (t: string) => void
  onSave: () => void
  onCancel: () => void
}) {
  /*
   * Focused, with the caret at the end.
   *
   * `autoFocus` alone leaves it at the start, which is the wrong end of a
   * sentence you opened in order to fix its last word — and the Up key that
   * opens this is pressed by people who have just noticed a typo.
   */
  const box = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const el = box.current
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [])

  return (
    <div className="my-1">
      <textarea
        ref={box}
        value={text}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            onSave()
          }
          if (e.key === 'Escape') onCancel()
        }}
        className="w-full resize-none rounded bg-gray-700 px-3 py-2 text-sm text-gray-100 outline-none focus:ring-1 focus:ring-indigo-500"
        rows={1}
      />
      <div className="mt-1 flex gap-2 text-xs text-gray-500">
        <span>
          escape to{' '}
          <button onClick={onCancel} className="text-blue-400 hover:underline">
            cancel
          </button>
        </span>
        <span>
          enter to{' '}
          <button onClick={onSave} className="text-blue-400 hover:underline">
            save
          </button>
        </span>
      </div>
    </div>
  )
}

/** Shows a compact preview of the message being replied to */
function ReplyPreview({
  serverId,
  channel,
  msgid,
  at,
  compact
}: {
  serverId: string
  channel: string
  msgid: string
  /** When the reply was said, as somewhere to fetch around when the original is not here */
  at?: string
  /**
   * The dense view, which has a time column where the avatar would be.
   *
   * The corner rises out of the avatar's own column, and in compact mode
   * there is no avatar to rise out of — so it would be a corner turning out of
   * a timestamp. A short rule is enough there: the quote is still a row above
   * the line, which is what says it is attached.
   */
  compact?: boolean
}) {
  const originalMsg = useMessageStore((s) => s.getMessageById(serverId, channel, msgid))

  /*
   * Clickable, and clickable even when the original is not loaded.
   *
   * "Original message not loaded" used to be the end of it: a line saying the
   * thing you wanted is elsewhere, with no way to go there. The id is enough
   * to ask for the conversation around it — the time comes back with it — so
   * the only case that cannot be answered is one where the message has no id
   * at all, which is a network without `message-tags`.
   */
  const go = (): void => {
    if (!msgid) return
    useUIStore.getState().setJumpTo({
      serverId,
      channel,
      msgid,
      timestamp: originalMsg?.timestamp ?? at ?? new Date().toISOString()
    })
  }

  const nick = originalMsg?.nick ?? ''
  const metadata = useServerStore((s) => s.userMetadata[`${serverId}:${nick.toLowerCase()}`])
  const shownName = metadata?.['display-name']?.trim() || nick

  return (
    <button
      onClick={go}
      className="group/reply mb-0.5 flex w-full items-center gap-1.5 text-left text-xs"
      title="Go to the message this replies to"
    >
      {/*
        The line that joins the quote to the reply.
        
        An arrow glyph said "this is a reply" and nothing about what it was
        attached to. A corner — up the avatar column, then right into the quote
        — says before a word is read that these two rows are one thing. Drawn
        with two borders and a rounded corner, which is all a corner is.
      */}
      <span
        className={
          compact
            ? 'mb-1 h-0 w-5 shrink-0 self-end border-t-2 border-gray-600'
            : 'mb-0.5 ml-5 h-2.5 w-9 shrink-0 self-end rounded-tl-md border-t-2 border-l-2 border-gray-600'
        }
        aria-hidden="true"
      />
      {originalMsg ? (
        <>
          {metadata?.avatar ? (
            <img
              src={metadata.avatar}
              alt=""
              referrerPolicy="no-referrer"
              crossOrigin="anonymous"
              className="h-4 w-4 shrink-0 rounded-full object-cover"
            />
          ) : (
            <span
              className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-bold"
              style={nickStyle(nick)}
            >
              {nick.charAt(0).toUpperCase()}
            </span>
          )}
          {/* Their colour, the same one their name has on the message itself */}
          <span className="shrink-0 font-medium" style={{ color: nickStyle(nick).backgroundColor }}>
            {shownName}
          </span>
          {/*
            One line, ellipsis. A quote is a reminder of what is being answered,
            not a second copy of it — and newlines become spaces, because a
            quote is one thought however many lines it was said over.
          */}
          <span className="truncate text-gray-400 group-hover/reply:text-gray-300">
            {originalMsg.content.replace(/\s*\n\s*/g, ' ')}
          </span>
        </>
      ) : (
        <span className="text-gray-600 italic">Go to the message this replies to</span>
      )}
    </button>
  )
}

const QUICK_EMOJIS = ['👍', '❤️', '😂', '🎉', '😢', '🤔', '👀', '🔥']

/** Hover actions for a message (react, reply, edit, delete) */
function MessageActions({
  message,
  onReply,
  isOwn,
  onEdit
}: {
  message: ChatMessage
  onReply?: (message: ChatMessage) => void
  isOwn?: boolean
  onEdit?: () => void
}) {
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const pickerRef = useRef<HTMLDivElement>(null)

  // Who may take a message back: its author, or a channel operator.
  //
  // `draft/message-redaction` says so and the server enforces it, so offering
  // an ordinary user a Delete button on everyone else's messages is offering an
  // action that can only fail.
  const currentNick = useServerStore((s) => s.currentNick[message.serverId] ?? '')
  const channelUsers = useUserStore(
    (s) => s.users[`${message.serverId}:${message.channel.toLowerCase()}`]
  )
  /*
   * Whether you may take down somebody else's message here.
   *
   * Asked of the network's own ladder rather than of three symbols written out
   * by hand. `@ ~ &` covers most servers and misses rIRCd, where a founder
   * wears `^` — so the one person in the channel who certainly may moderate it
   * was the one person not offered the option.
   */
  const prefixValue = useServerStore((s) => s.isupport[message.serverId]?.['PREFIX'])
  const holdsOps = (channelUsers ?? []).some(
    (user) =>
      user.nick.toLowerCase() === currentNick.toLowerCase() &&
      canModerate(prefixValue, user.prefixes.join(''))
  )
  const canRedact = Boolean(isOwn) || holdsOps

  /*
   * And whether this one can be amended — see `@shared/editing`.
   *
   * `isOwn` alone offered it on two things it does not work on: an action,
   * whose CTCP wrapper the edit does not carry, and any message at all on a
   * server without the capability, where the "edit" arrives as a second
   * message and the first stays where it was.
   */
  const capabilities = useServerStore((s) => s.capabilities[message.serverId])
  const editable = canEdit(message, currentNick, capabilities ?? [])

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
    // Through speak, because a network that will not carry reactions says so
    // and somebody has to hear it. Silently doing nothing is what this
    // replaces.
    speak(
      window.switchboard.invoke(
        'message:react',
        message.serverId,
        message.channel,
        message.id,
        emoji
      ),
      'That reaction was not sent'
    )
    setShowEmojiPicker(false)
  }

  const handleRedact = () => {
    // Ask, and let the server's REDACT come back and remove it.
    //
    // Removing it here first meant a refusal — not the author, not an op, or a
    // server that does not carry redaction at all — still emptied the message
    // out of the window, and only a reload brought it back.
    window.switchboard.invoke('message:redact', message.serverId, message.channel, message.id)
  }

  return (
    <div className="absolute -top-3 right-2 z-10 flex gap-0.5 rounded-md border border-gray-600/60 bg-gray-700 opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
      {/* Delete confirmation popup */}
      {showDeleteConfirm && (
        <div className="absolute -top-1 right-0 z-30 -translate-y-full rounded-lg border border-gray-600/60 bg-gray-800 p-3 shadow-xl">
          <p className="mb-2 whitespace-nowrap text-sm text-gray-300">Delete this message?</p>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setShowDeleteConfirm(false)}
              className="rounded px-3 py-1 text-xs text-gray-400 hover:bg-gray-700 hover:text-gray-200"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                handleRedact()
                setShowDeleteConfirm(false)
              }}
              className="rounded bg-red-500 px-3 py-1 text-xs text-white hover:bg-red-400"
            >
              Delete
            </button>
          </div>
        </div>
      )}

      {/* React */}
      <div className="relative" ref={pickerRef}>
        <IconButton
          icon={SmilePlus}
          label="Add reaction"
          surface="raised"
          onClick={() => setShowEmojiPicker(!showEmojiPicker)}
        />

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
        <IconButton
          icon={CornerUpLeft}
          label="Reply"
          surface="raised"
          onClick={() => onReply(message)}
        />
      )}

      {/* Edit — see `editable` above for the two cases this excludes */}
      {editable && onEdit && (
        <IconButton icon={Pencil} label="Edit message" surface="raised" onClick={onEdit} />
      )}

      {/* Delete (redact) — the author, or an operator */}
      {canRedact && (
        <IconButton
          icon={Trash2}
          label="Delete message"
          surface="raised"
          danger
          onClick={() => setShowDeleteConfirm(true)}
        />
      )}
    </div>
  )
}

/** Nick with WHOIS popup on hover */
function NickWithPopup({
  nick,
  serverId,
  className
}: {
  nick: string
  serverId: string
  className?: string
}) {
  const popupWhoisData = useUIStore((s) =>
    s.popupWhoisData?.nick.toLowerCase() === nick.toLowerCase() ? s.popupWhoisData : null
  )
  const userMetadata = useServerStore((s) => s.userMetadata)
  const metadata = userMetadata[`${serverId}:${nick.toLowerCase()}`] ?? {}
  const shownName = displayNameFor(nick, metadata)
  const nameColor = metadataColor(metadata.color)
  const [showPopup, setShowPopup] = useState(false)
  // A card opened by clicking stays until it is dismissed; one that drifted
  // open under the pointer goes when the pointer does
  const [pinned, setPinned] = useState(false)
  const [popupStyle, setPopupStyle] = useState<React.CSSProperties>({})
  const [fetched, setFetched] = useState(false)
  const hoverTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hideTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)
  const popupRef = useRef<HTMLDivElement>(null)
  const nickRect = useRef<DOMRect | null>(null)

  // A click anywhere else puts a pinned card away
  useEffect(() => {
    if (!pinned) return
    const away = (): void => {
      setShowPopup(false)
      setPinned(false)
    }
    document.addEventListener('click', away)
    return () => document.removeEventListener('click', away)
  }, [pinned])

  // Reposition popup after it renders (and when content changes from loading → data)
  useEffect(() => {
    if (!showPopup || !popupRef.current || !nickRect.current) return
    const rect = nickRect.current
    const popup = popupRef.current.getBoundingClientRect()
    const pad = 8

    let top = rect.bottom + 4
    let left = rect.left

    // Flip above if not enough room below
    if (top + popup.height + pad > window.innerHeight) {
      top = rect.top - popup.height - 4
    }
    // Clamp to top
    if (top < pad) top = pad

    // Clamp horizontally
    if (left + popup.width + pad > window.innerWidth) {
      left = window.innerWidth - popup.width - pad
    }
    if (left < pad) left = pad

    setPopupStyle({ left, top })
  }, [showPopup, popupWhoisData])

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
      nickRect.current = (e.target as HTMLElement).getBoundingClientRect()
      setPopupStyle({ left: nickRect.current.left, top: nickRect.current.bottom + 4 })
      setShowPopup(true)
      fetchWhois()
    }, 400)
  }

  const handleMouseLeave = () => {
    if (hoverTimeout.current) {
      clearTimeout(hoverTimeout.current)
      hoverTimeout.current = null
    }
    if (pinned) return
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
    if (pinned) return
    hideTimeout.current = setTimeout(() => {
      setShowPopup(false)
    }, 200)
  }

  /*
   * Clicking opens it too, and keeps it open.
   *
   * Hover alone is a discoverability problem — a card that only appears if you
   * rest on a name for four hundred milliseconds is a card most people never
   * see — and it is the wrong way round for the moderation actions, which you
   * want to be able to read before pressing. A click cancels the hover's
   * hide, so moving the pointer away no longer takes it with you.
   */
  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (hoverTimeout.current) {
      clearTimeout(hoverTimeout.current)
      hoverTimeout.current = null
    }
    if (hideTimeout.current) {
      clearTimeout(hideTimeout.current)
      hideTimeout.current = null
    }
    if (showPopup) {
      setShowPopup(false)
      return
    }
    nickRect.current = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setPopupStyle({ left: nickRect.current.left, top: nickRect.current.bottom + 4 })
    setShowPopup(true)
    setPinned(true)
    fetchWhois()
  }

  return (
    <>
      <span
        className={className}
        style={nameColor ? { color: nameColor } : undefined}
        // The nick is still the identity — keep it reachable when a display
        // name is standing in for it.
        title={shownName === nick ? nick : `${shownName} (${nick})`}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onClick={handleClick}
      >
        {shownName}
      </span>

      {showPopup && (
        <div
          ref={popupRef}
          className="fixed z-50 max-h-[80vh] w-72 overflow-y-auto rounded-lg border border-gray-700 bg-gray-800 p-3 shadow-xl"
          style={popupStyle}
          onMouseEnter={handlePopupEnter}
          onMouseLeave={handlePopupLeave}
          onClick={(e) => e.stopPropagation()}
        >
          <ProfileCard
            nick={nick}
            serverId={serverId}
            onClose={() => {
              setShowPopup(false)
              setPinned(false)
            }}
          />
        </div>
      )}
    </>
  )
}

function MessageAvatar({ nick, avatarUrl }: { nick: string; avatarUrl: string | null }) {
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    setFailed(false)
  }, [avatarUrl])

  if (avatarUrl && !failed) {
    return (
      <img
        src={avatarUrl}
        alt={nick}
        referrerPolicy="no-referrer"
        crossOrigin="anonymous"
        className="mr-4 mt-0.5 h-10 w-10 flex-shrink-0 rounded-full object-cover"
        onError={() => setFailed(true)}
      />
    )
  }

  return (
    <div
      className="mr-4 mt-0.5 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-sm font-bold"
      style={nickStyle(nick)}
    >
      {nick.charAt(0).toUpperCase()}
    </div>
  )
}

/**
 * The reactions on a message.
 *
 * Each one is a button that toggles your own: these were rendered as buttons
 * with nothing behind them, so the whole row looked interactive and was not —
 * and a reaction you cannot take back is one people hesitate to leave.
 */
function Reactions({ message }: { message: ChatMessage }) {
  const currentNick = useServerStore((s) => s.currentNick[message.serverId] ?? '')

  const toggle = (emoji: string, mine: boolean) => {
    speak(
      window.switchboard.invoke(
        'message:react',
        message.serverId,
        message.channel,
        message.id,
        emoji,
        mine
      ),
      'That reaction was not sent'
    )
  }

  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {Object.entries(message.reactions).map(([emoji, nicks]) => {
        const mine = nicks.some((nick) => nick.toLowerCase() === currentNick.toLowerCase())
        return (
          <button
            key={emoji}
            onClick={() => toggle(emoji, mine)}
            className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-sm ${
              mine
                ? 'border-indigo-500 bg-indigo-500/20 hover:bg-indigo-500/30'
                : 'border-gray-700 bg-gray-800 hover:bg-gray-700'
            }`}
            title={nicks.join(', ')}
          >
            <span>{emoji}</span>
            <span className={`text-xs ${mine ? 'text-indigo-400' : 'text-gray-400'}`}>
              {nicks.length}
            </span>
          </button>
        )
      })}
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
    return (
      d.toLocaleDateString([], { month: 'short', day: 'numeric' }) +
      ' at ' +
      d.toLocaleTimeString([], timeOpts)
    )
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
