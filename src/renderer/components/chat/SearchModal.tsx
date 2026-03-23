import { useState, useCallback, useRef, useEffect } from 'react'
import { Modal } from '../common/Modal'
import { useUIStore } from '../../stores/uiStore'
import { useServerStore } from '../../stores/serverStore'
import { useChannelStore } from '../../stores/channelStore'
import { MessageContent } from './MessageContent'
import type { ChatMessage } from '@shared/types/message'

export function SearchModal() {
  const closeModal = useUIStore((s) => s.closeModal)
  const activeServerId = useServerStore((s) => s.activeServerId)
  const capabilities = useServerStore((s) =>
    activeServerId ? s.capabilities[activeServerId] ?? [] : []
  )
  const hasServerSearch = capabilities.includes('draft/search')
  const activeChannel = useChannelStore((s) =>
    activeServerId ? s.activeChannel[activeServerId] ?? null : null
  )

  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ChatMessage[]>([])
  const [searching, setSearching] = useState(false)
  const [searchScope, setSearchScope] = useState<'channel' | 'server'>('channel')
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
      setResults(messages || [])
      setSearching(false)
    })
    return cleanup
  }, [])

  const doSearch = useCallback(
    (q: string) => {
      if (!activeServerId || !q.trim()) {
        setResults([])
        return
      }

      setSearching(true)
      const channel = searchScope === 'channel' ? activeChannel ?? undefined : undefined

      if (searchSource === 'server' && hasServerSearch) {
        // Server-side search — results arrive via irc:search-results event
        window.switchboard
          .invoke('message:search-server', activeServerId, q.trim(), channel)
          .catch(() => setSearching(false))
      } else {
        // Local SQLite search
        window.switchboard
          .invoke('message:search', activeServerId, q.trim(), channel)
          .then((msgs) => {
            setResults(msgs || [])
          })
          .finally(() => setSearching(false))
      }
    },
    [activeServerId, activeChannel, searchScope, searchSource, hasServerSearch]
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
    (msg: ChatMessage) => {
      if (!activeServerId) return
      // Navigate to the message's channel
      useChannelStore.getState().setActiveChannel(activeServerId, msg.channel)
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
            <svg
              className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="M21 21l-4.35-4.35" />
            </svg>
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
              className={`rounded-r px-3 py-2 text-xs ${
                searchScope === 'server'
                  ? 'bg-gray-700 text-gray-100'
                  : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              Server
            </button>
          </div>

          {/* Source toggle — only show if server supports draft/search */}
          {hasServerSearch && (
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

          {results.map((msg) => (
            <button
              key={msg.id}
              onClick={() => handleResultClick(msg)}
              className="w-full rounded px-3 py-2 text-left hover:bg-gray-700/50"
            >
              <div className="flex items-baseline gap-2">
                <span className="font-medium text-gray-200">{msg.nick}</span>
                <span className="text-xs text-gray-500">
                  in {msg.channel}
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
