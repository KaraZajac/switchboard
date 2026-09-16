import { useEffect, useState } from 'react'
import { AtSign, Hash } from 'lucide-react'
import { useServerStore } from '../../stores/serverStore'
import { useChannelStore } from '../../stores/channelStore'
import { useUIStore } from '../../stores/uiStore'
import { FormattedText } from '../chat/MessageContent'
import { nickColor } from '../../utils/nickColor'
import type { Mention } from '@shared/types/ipc'

/**
 * Every line that named you, across every network, newest first.
 *
 * The badge on a channel has always counted these and then forgotten which
 * lines they were, so the question it raises — what did they say? — could only
 * be answered by going network by network, channel by channel, looking for
 * your own nick in red. On a morning with four networks and a badge on each,
 * that is the whole of the work.
 *
 * Asked of the main process rather than assembled here: this window holds one
 * network's messages at a time, and the ones already on screen are exactly the
 * ones nobody needs to go looking for. The rule that decides what counts is
 * `@shared/mentions` — the same one the badge and the notification use.
 */
export function MentionsView() {
  const [mentions, setMentions] = useState<Mention[] | null>(null)
  const servers = useServerStore((s) => s.servers)

  useEffect(() => {
    let alive = true

    const load = (): void => {
      window.switchboard
        .invoke('mentions:recent', 100)
        .then((found) => {
          if (alive) setMentions(found)
        })
        .catch(() => {
          if (alive) setMentions([])
        })
    }

    load()
    // A mention arriving while this is open is the one thing it exists to
    // show; without this it would be a list that quietly went stale in front
    // of somebody watching it.
    const off = window.switchboard.on('irc:message', load)

    return () => {
      alive = false
      off()
    }
  }, [])

  const go = (mention: Mention): void => {
    useUIStore.getState().setMentionsMode(false)
    useServerStore.getState().setActiveServer(mention.serverId)
    useChannelStore.getState().setActiveChannel(mention.serverId, mention.channel)
    // To the line, not to the room it was said in. Landing at the bottom of a
    // busy channel and being left to find the mention yourself is most of the
    // work this list was supposed to save.
    useUIStore.getState().setJumpTo({
      serverId: mention.serverId,
      channel: mention.channel,
      msgid: mention.id ?? null,
      timestamp: mention.timestamp
    })
  }

  if (mentions === null) return <div className="flex-1" />

  if (mentions.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="max-w-sm text-center">
          <AtSign size={64} strokeWidth={1.5} className="mx-auto mb-4 text-gray-600" />
          <h2 className="mb-2 text-xl font-semibold text-gray-300">No mentions</h2>
          <p className="text-sm text-gray-500">
            When somebody says your nick — or one of your highlight words — in a channel, it
            will be here.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto">
      {mentions.map((mention) => (
        <button
          key={mention.id}
          onClick={() => go(mention)}
          className="block w-full border-b border-gray-800 px-4 py-3 text-left hover:bg-gray-700/25"
        >
          {/* Where it was said. Both halves, always: the whole point of this
              view is that the network is no longer implied by what you have
              open. */}
          <div className="mb-1 flex items-center gap-1.5 text-xs text-gray-500">
            <span className="shrink-0">
              {servers.find((s) => s.id === mention.serverId)?.name ?? mention.serverName}
            </span>
            <Hash size={12} strokeWidth={2} className="shrink-0" aria-hidden="true" />
            <span className="truncate">{mention.channel.replace(/^#/, '')}</span>
            <span className="ml-auto shrink-0">{when(mention.timestamp)}</span>
          </div>

          <div className="flex items-baseline gap-2">
            <span
              className="shrink-0 text-sm font-medium"
              style={{ color: nickColor(mention.nick) }}
            >
              {mention.nick}
            </span>
            <span className="min-w-0 break-words text-sm text-gray-200">
              <FormattedText text={mention.content} />
            </span>
          </div>
        </button>
      ))}
    </div>
  )
}

/**
 * When it was said, in as few words as carry it.
 *
 * A list that crosses days needs the day; a list of this morning needs the
 * time. Saying both on every row is noise in the column that matters least.
 */
function when(iso: string): string {
  try {
    const at = new Date(iso)
    const hour12 = useUIStore.getState().timeFormat === '12h'
    const time = at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12 })

    if (at.toDateString() === new Date().toDateString()) return time
    return at.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + time
  } catch {
    return ''
  }
}
