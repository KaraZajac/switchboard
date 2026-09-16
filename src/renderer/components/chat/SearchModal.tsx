import { Search } from 'lucide-react'
import { ICON } from '../common/IconButton'
import { useState, useCallback, useRef, useEffect } from 'react'
import { Modal } from '../common/Modal'
import { useUIStore } from '../../stores/uiStore'
import { useServerStore } from '../../stores/serverStore'
import { useChannelStore } from '../../stores/channelStore'
import { MessageContent } from './MessageContent'
import type { ChatMessage } from '@shared/types/message'
import { whereSaid, type Found } from '@shared/search'

/**
 * One network's result as a result from anywhere.
 *
 * The two searches that answer for a single network hand back messages, which
 * carry no network — they never needed to, because there was only ever one.
 */
function found(message: ChatMessage, network: string): Found {
  return {
    id: message.id,
    serverId: message.serverId,
    network,
    channel: message.channel,
    nick: message.nick,
    content: message.content,
    timestamp: message.timestamp
  }
}

// Stable, for the same reason as the channel browser's empty list: a selector
// must hand back the same value while nothing has changed, or React re-renders
// until it gives up. Search opened on a network still connecting had no
// capability list yet, and the window died.
const NO_CAPABILITIES: string[] = []

export function SearchModal() {
  const closeModal = useUIStore((s) => s.closeModal)
  const activeServerId = useServerStore((s) => s.activeServerId)
  const servers = useServerStore((s) => s.servers)
  const capabilities = useServerStore((s) =>
    activeServerId ? (s.capabilities[activeServerId] ?? NO_CAPABILITIES) : NO_CAPABILITIES
  )
  const hasServerSearch = capabilities.includes('draft/search')
  const activeChannel = useChannelStore((s) =>
    activeServerId ? s.activeChannel[activeServerId] ?? null : null
  )

  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Found[]>([])
  const [searching, setSearching] = useState(false)
  /*
   * Everywhere by default.
   *
   * This opens from the header as "find something somebody said", and the
   * honest answer to that is not "on this network". Narrowing to the channel
   * you are in is one click away and the click is obvious; remembering which
   * of six networks a conversation happened on is neither.
   */
  const [searchScope, setSearchScope] = useState<'channel' | 'server' | 'everywhere'>('everywhere')
  const [searchSource, setSearchSource] = useState<'local' | 'server'>('local')
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Listen for server-side search results
  useEffect(() => {
    if (!window.switchboard) return
    const cleanup = window.switchboard.on('irc:search-results', ({ messages }) => {
      const network = useServerStore.getState().servers.find((s) => s.id === activeServerId)
      setResults((messages || []).map((m) => found(m, network?.name ?? '')))
      setSearching(false)
    })
    return cleanup
  }, [activeServerId])

  const doSearch = useCallback(
    (q: string) => {
      if (!activeServerId || !q.trim()) {
        setResults([])
        return
      }

      setSearching(true)

      // Every network at once. Nothing to scope to a channel here: a channel
      // belongs to one network, so asking for both is asking for the narrower.
      if (searchScope === 'everywhere') {
        window.switchboard
          .invoke('search:everywhere', q.trim(), 100)
          .then((found) => setResults(found || []))
          .finally(() => setSearching(false))
        return
      }

      const channel = searchScope === 'channel' ? activeChannel ?? undefined : undefined
      const network = servers.find((s) => s.id === activeServerId)?.name ?? ''

      if (searchSource === 'server' && hasServerSearch) {
        // Server-side search — results arrive via irc:search-results event
        window.switchboard
          .invoke('message:search-server', activeServerId, q.trim(), channel)
          .catch(() => setSearching(false))
      } else {
        // Local SQLite search
        window.switchboard
          .invoke('message:search', activeServerId, q.trim(), channel)
          .then((msgs) => setResults((msgs || []).map((m) => found(m, network))))
          .finally(() => setSearching(false))
      }
    },
    [activeServerId, activeChannel, searchScope, searchSource, hasServerSearch, servers]
  )

  const handleQueryChange = useCallback(
    (value: string) => {
      setQuery(value)
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => doSearch(value), 300)
    },
    [doSearch]
  )

  const handleResultClick = useCallback(
    (msg: Found) => {
      // To the network it was said on, which is no longer the one on screen:
      // a result from everywhere carries its own
      const serverId = msg.serverId || activeServerId
      if (!serverId) return
      useUIStore.getState().setDmMode(false)
      useServerStore.getState().setActiveServer(serverId)
      useChannelStore.getState().addChannel(serverId, msg.channel)
      useChannelStore.getState().setActiveChannel(serverId, msg.channel)
      // To the line. A result from March opens a conversation that does not
      // hold it yet, so the jump fetches around it — see `@shared/jump`.
      useUIStore.getState().setJumpTo({
        serverId,
        channel: msg.channel,
        msgid: msg.id || null,
        timestamp: msg.timestamp
      })
      closeModal()
    },
    [activeServerId, closeModal]
  )

  return (
    <Modal title="Search Messages" onClose={closeModal} width="max-w-2xl">
      <div className="space-y-3">
        {/* Search input */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search
              size={ICON.sm}
              strokeWidth={2}
              aria-hidden="true"
              className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
            />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => handleQueryChange(e.target.value)}
              placeholder="Search messages..."
              className="w-full rounded bg-gray-900 py-2 pl-10 pr-3 text-gray-100 outline-none ring-1 ring-gray-700 focus:ring-indigo-500"
            />
          </div>

          {/* Scope toggle */}
          <div className="flex rounded bg-gray-900 ring-1 ring-gray-700">
            <button
              onClick={() => setSearchScope('channel')}
              className={`rounded-l px-3 py-2 text-xs ${
                searchScope === 'channel'
                  ? 'bg-gray-700 text-gray-100'
                  : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              Channel
            </button>
            <button
              onClick={() => setSearchScope('server')}
              className={`px-3 py-2 text-xs ${
                searchScope === 'server'
                  ? 'bg-gray-700 text-gray-100'
                  : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              Network
            </button>
            <button
              onClick={() => setSearchScope('everywhere')}
              className={`rounded-r px-3 py-2 text-xs ${
                searchScope === 'everywhere'
                  ? 'bg-gray-700 text-gray-100'
                  : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              Everywhere
            </button>
          </div>

          {/*
            Local or the network's own — only where a network can answer, and
            only when the question is about one. A server can search itself and
            nothing else.
          */}
          {hasServerSearch && searchScope !== 'everywhere' && (
            <div className="flex rounded bg-gray-900 ring-1 ring-gray-700">
              <button
                onClick={() => setSearchSource('local')}
                className={`rounded-l px-3 py-2 text-xs ${
                  searchSource === 'local'
                    ? 'bg-gray-700 text-gray-100'
                    : 'text-gray-400 hover:text-gray-200'
                }`}
                title="Search local message history"
              >
                Local
              </button>
              <button
                onClick={() => setSearchSource('server')}
                className={`rounded-r px-3 py-2 text-xs ${
                  searchSource === 'server'
                    ? 'bg-gray-700 text-gray-100'
                    : 'text-gray-400 hover:text-gray-200'
                }`}
                title="Search server-side message history"
              >
                Remote
              </button>
            </div>
          )}
        </div>

        {/* Results */}
        <div className="max-h-96 overflow-y-auto">
          {searching && (
            <div className="py-4 text-center text-sm text-gray-500">Searching...</div>
          )}

          {!searching && query && results.length === 0 && (
            <div className="py-4 text-center text-sm text-gray-500">
              No results found
            </div>
          )}

          {results.map((msg, at) => (
            <button
              key={`${msg.serverId}:${msg.channel}:${msg.timestamp}:${at}`}
              onClick={() => handleResultClick(msg)}
              className="w-full rounded px-3 py-2 text-left hover:bg-gray-700/50"
            >
              <div className="flex items-baseline gap-2">
                <span className="font-medium text-gray-200">{msg.nick}</span>
                {/* `#channel@network`, the way a friend is `nick@network` —
                    neither half means anything on its own */}
                <span className="text-xs text-gray-500">
                  in {servers.length > 1 ? whereSaid(msg.channel, msg.network) : msg.channel}
                </span>
                <span className="text-xs text-gray-600">
                  {formatSearchTime(msg.timestamp)}
                </span>
              </div>
              <div className="mt-0.5 truncate text-sm text-gray-400">
                <MessageContent text={msg.content} />
              </div>
            </button>
          ))}

          {!searching && !query && (
            <div className="py-4 text-center text-sm text-gray-500">
              Type to search message history
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}

function formatSearchTime(iso: string): string {
  try {
    const d = new Date(iso)
    const hour12 = useUIStore.getState().timeFormat === '12h'
    return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) +
      ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12 })
  } catch {
    return ''
  }
}
