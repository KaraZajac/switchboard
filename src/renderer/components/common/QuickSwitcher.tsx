import { useState, useRef, useEffect, useCallback } from 'react'
import { useUIStore } from '../../stores/uiStore'
import { useServerStore } from '../../stores/serverStore'
import { useChannelStore } from '../../stores/channelStore'

interface SwitcherItem {
  serverId: string
  serverName: string
  channel: string
}

export function QuickSwitcher() {
  const closeModal = useUIStore((s) => s.closeModal)
  const servers = useServerStore((s) => s.servers)
  const allChannels = useChannelStore((s) => s.channels)

  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Build flat list of all channels across all servers
  const allItems: SwitcherItem[] = []
  for (const server of servers) {
    const channels = allChannels[server.id] || []
    for (const ch of channels) {
      allItems.push({
        serverId: server.id,
        serverName: server.name,
        channel: ch.name
      })
    }
  }

  // Filter by query
  const filtered = query.trim()
    ? allItems.filter((item) =>
        item.channel.toLowerCase().includes(query.toLowerCase()) ||
        item.serverName.toLowerCase().includes(query.toLowerCase())
      )
    : allItems

  // Clamp selected index
  const clampedIndex = Math.min(selectedIndex, filtered.length - 1)

  const handleSelect = useCallback(
    (item: SwitcherItem) => {
      useServerStore.getState().setActiveServer(item.serverId)
      useChannelStore.getState().setActiveChannel(item.serverId, item.channel)
      useChannelStore.getState().clearUnread(item.serverId, item.channel)
      closeModal()
    },
    [closeModal]
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex((i) => Math.max(i - 1, 0))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        if (filtered[clampedIndex]) handleSelect(filtered[clampedIndex])
      } else if (e.key === 'Escape') {
        closeModal()
      }
    },
    [filtered, clampedIndex, handleSelect, closeModal]
  )

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-24" onClick={closeModal}>
      <div
        className="w-full max-w-lg rounded-lg bg-gray-800 shadow-2xl ring-1 ring-gray-700"
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
          placeholder="Jump to channel..."
          className="w-full rounded-t-lg border-b border-gray-700 bg-transparent px-4 py-3 text-gray-100 placeholder-gray-400 outline-none"
        />

        <div className="max-h-64 overflow-y-auto py-1">
          {filtered.length === 0 && (
            <div className="px-4 py-3 text-sm text-gray-500">No channels found</div>
          )}
          {filtered.map((item, i) => (
            <button
              key={`${item.serverId}:${item.channel}`}
              onClick={() => handleSelect(item)}
              className={`flex w-full items-center gap-2 px-4 py-2 text-left ${
                i === clampedIndex ? 'bg-indigo-500/20 text-gray-100' : 'text-gray-300 hover:bg-gray-700/50'
              }`}
            >
              <span className="text-gray-500">#</span>
              <span className="flex-1">{item.channel.replace(/^#/, '')}</span>
              <span className="text-xs text-gray-500">{item.serverName}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
