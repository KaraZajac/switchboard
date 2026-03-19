import { useState, useRef, useEffect, useCallback } from 'react'
import { useServerStore } from '../../stores/serverStore'
import { useChannelStore } from '../../stores/channelStore'

interface ChannelEntry {
  name: string
  userCount: number
  topic: string
}

interface ChannelBrowserProps {
  onClose: () => void
}

export function ChannelBrowser({ onClose }: ChannelBrowserProps) {
  const activeServerId = useServerStore((s) => s.activeServerId)
  const joinedChannels = useChannelStore((s) =>
    activeServerId ? s.channels[activeServerId] ?? [] : []
  )

  const [channels, setChannels] = useState<ChannelEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const joinedSet = new Set(joinedChannels.map((ch) => ch.name.toLowerCase()))

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    if (!activeServerId) return

    setLoading(true)
    setError(null)

    window.switchboard
      .invoke('channel:list', activeServerId)
      .then((result) => {
        result.sort((a, b) => b.userCount - a.userCount)
        setChannels(result)
        setLoading(false)
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to fetch channel list')
        setLoading(false)
      })
  }, [activeServerId])

  const filtered = query.trim()
    ? channels.filter(
        (ch) =>
          ch.name.toLowerCase().includes(query.toLowerCase()) ||
          ch.topic.toLowerCase().includes(query.toLowerCase())
      )
    : channels

  const handleJoin = useCallback(
    (channelName: string) => {
      if (!activeServerId) return
      window.switchboard.invoke('channel:join', activeServerId, channelName)
      onClose()
    },
    [activeServerId, onClose]
  )

  // Determine if we should show a "create channel" option
  const trimmedQuery = query.trim()
  const queryAsChannel = trimmedQuery
    ? trimmedQuery.startsWith('#') ? trimmedQuery : `#${trimmedQuery}`
    : ''
  const showCreateOption =
    !loading &&
    !error &&
    trimmedQuery.length > 0 &&
    filtered.length === 0 &&
    !joinedSet.has(queryAsChannel.toLowerCase())

  // Total selectable items (filtered results + optional create option)
  const totalItems = filtered.length + (showCreateOption ? 1 : 0)
  const clampedTotal = Math.min(selectedIndex, Math.max(totalItems - 1, 0))

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex((i) => {
          const next = Math.min(i + 1, totalItems - 1)
          scrollToIndex(next)
          return next
        })
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex((i) => {
          const next = Math.max(i - 1, 0)
          scrollToIndex(next)
          return next
        })
      } else if (e.key === 'Enter') {
        e.preventDefault()
        if (filtered[clampedTotal]) {
          handleJoin(filtered[clampedTotal].name)
        } else if (showCreateOption && clampedTotal === filtered.length) {
          handleJoin(queryAsChannel)
        }
      } else if (e.key === 'Escape') {
        onClose()
      }
    },
    [filtered, clampedTotal, totalItems, handleJoin, onClose, showCreateOption, queryAsChannel]
  )

  const scrollToIndex = (index: number) => {
    const container = listRef.current
    if (!container) return
    const item = container.children[index] as HTMLElement | undefined
    item?.scrollIntoView({ block: 'nearest' })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-20" onClick={onClose}>
      <div
        className="w-full max-w-xl rounded-lg bg-gray-800 shadow-2xl ring-1 ring-gray-700"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setSelectedIndex(0)
          }}
          placeholder="Filter channels..."
          className="w-full rounded-t-lg border-b border-gray-700 bg-transparent px-4 py-3 text-gray-100 placeholder-gray-400 outline-none"
        />

        <div ref={listRef} className="max-h-80 overflow-y-auto py-1">
          {loading && (
            <div className="px-4 py-8 text-center text-sm text-gray-500">
              Loading channel list...
            </div>
          )}

          {error && (
            <div className="px-4 py-8 text-center text-sm text-red-400">{error}</div>
          )}

          {!loading && !error && filtered.length === 0 && !showCreateOption && (
            <div className="px-4 py-8 text-center text-sm text-gray-500">
              No channels found
            </div>
          )}

          {!loading &&
            filtered.map((ch, i) => {
              const isJoined = joinedSet.has(ch.name.toLowerCase())
              return (
                <button
                  key={ch.name}
                  onClick={() => {
                    if (!isJoined) handleJoin(ch.name)
                  }}
                  className={`flex w-full items-start gap-3 px-4 py-2 text-left ${
                    i === clampedTotal
                      ? 'bg-indigo-500/20 text-gray-100'
                      : 'text-gray-300 hover:bg-gray-700/50'
                  } ${isJoined ? 'opacity-50' : ''}`}
                >
                  <span className="mt-0.5 shrink-0 text-gray-500">#</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{ch.name.replace(/^#/, '')}</span>
                      {isJoined && (
                        <span className="text-xs text-green-400">joined</span>
                      )}
                    </div>
                    {ch.topic && (
                      <p className="truncate text-xs text-gray-500">{ch.topic}</p>
                    )}
                  </div>
                  <span className="mt-0.5 shrink-0 text-xs text-gray-500">
                    {ch.userCount.toLocaleString()}
                  </span>
                </button>
              )
            })}

          {showCreateOption && (
            <button
              onClick={() => handleJoin(queryAsChannel)}
              className={`flex w-full items-center gap-3 px-4 py-3 text-left ${
                clampedTotal === filtered.length
                  ? 'bg-indigo-500/20 text-gray-100'
                  : 'text-gray-300 hover:bg-gray-700/50'
              }`}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className="shrink-0 text-indigo-400">
                <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />
              </svg>
              <span>
                Join or create <span className="font-semibold text-indigo-400">{queryAsChannel}</span>
              </span>
            </button>
          )}
        </div>

        {!loading && !error && (filtered.length > 0 || showCreateOption) && (
          <div className="border-t border-gray-700 px-4 py-2 text-xs text-gray-500">
            {filtered.length} channel{filtered.length !== 1 ? 's' : ''}
            {query && filtered.length !== channels.length && ` (${channels.length} total)`}
          </div>
        )}
      </div>
    </div>
  )
}
