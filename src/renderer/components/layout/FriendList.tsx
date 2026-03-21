import { useState, useCallback } from 'react'
import { useUserStore, type MonitoredNick } from '../../stores/userStore'
import { useServerStore } from '../../stores/serverStore'
import { nickColor } from '../../utils/nickColor'

const EMPTY_MONITOR: MonitoredNick[] = []

export function FriendList() {
  const activeServerId = useServerStore((s) => s.activeServerId)
  const monitoredNicks = useUserStore((s) =>
    activeServerId ? s.monitoredNicks[activeServerId] ?? EMPTY_MONITOR : EMPTY_MONITOR
  )
  const connectionStatus = useServerStore((s) =>
    activeServerId ? s.connectionStatus[activeServerId] ?? 'disconnected' : 'disconnected'
  )

  const [addingNick, setAddingNick] = useState(false)
  const [newNick, setNewNick] = useState('')

  const online = monitoredNicks.filter((m) => m.online)
  const offline = monitoredNicks.filter((m) => !m.online)

  const handleAdd = useCallback(() => {
    const nick = newNick.trim()
    if (!nick || !activeServerId) return
    window.switchboard.invoke('monitor:add', activeServerId, [nick])
    useUserStore.getState().addMonitorNick(activeServerId, nick)
    setNewNick('')
    setAddingNick(false)
  }, [newNick, activeServerId])

  const handleRemove = useCallback((nick: string) => {
    if (!activeServerId) return
    window.switchboard.invoke('monitor:remove', activeServerId, [nick])
    useUserStore.getState().removeMonitorNick(activeServerId, nick)
  }, [activeServerId])

  if (connectionStatus !== 'connected') return null
  if (monitoredNicks.length === 0 && !addingNick) {
    return (
      <div className="px-1">
        <div className="mb-1 flex items-center justify-between px-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">
            Friends
          </span>
          <button
            onClick={() => setAddingNick(true)}
            className="rounded p-0.5 text-gray-400 hover:bg-gray-700 hover:text-gray-200"
            title="Add friend"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />
            </svg>
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="px-1">
      <div className="mb-1 flex items-center justify-between px-1">
        <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">
          Friends
        </span>
        <button
          onClick={() => setAddingNick(true)}
          className="rounded p-0.5 text-gray-400 hover:bg-gray-700 hover:text-gray-200"
          title="Add friend"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />
          </svg>
        </button>
      </div>

      {addingNick && (
        <form
          className="mb-1 flex gap-1 px-1"
          onSubmit={(e) => { e.preventDefault(); handleAdd() }}
        >
          <input
            type="text"
            value={newNick}
            onChange={(e) => setNewNick(e.target.value)}
            placeholder="Nickname"
            autoFocus
            className="min-w-0 flex-1 rounded bg-gray-900 px-2 py-1 text-sm text-gray-200 outline-none placeholder:text-gray-500 focus:ring-1 focus:ring-indigo-500"
            onKeyDown={(e) => { if (e.key === 'Escape') { setAddingNick(false); setNewNick('') } }}
          />
          <button
            type="submit"
            className="rounded bg-indigo-600 px-2 py-1 text-xs text-white hover:bg-indigo-500"
          >
            Add
          </button>
        </form>
      )}

      {online.length > 0 && (
        <div className="mb-1">
          <span className="px-1 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
            Online — {online.length}
          </span>
          {online.map((m) => (
            <FriendEntry
              key={m.nick}
              nick={m.nick}
              online
              onRemove={handleRemove}
            />
          ))}
        </div>
      )}

      {offline.length > 0 && (
        <div className="mb-1">
          <span className="px-1 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
            Offline — {offline.length}
          </span>
          {offline.map((m) => (
            <FriendEntry
              key={m.nick}
              nick={m.nick}
              online={false}
              onRemove={handleRemove}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function FriendEntry({ nick, online, onRemove }: { nick: string; online: boolean; onRemove: (nick: string) => void }) {
  const [hover, setHover] = useState(false)
  const avatarColor = nickColor(nick)

  return (
    <div
      className="group flex items-center gap-2 rounded px-2 py-1 hover:bg-gray-700/50"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div className="relative">
        <div className={`flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold text-white ${avatarColor} ${!online ? 'opacity-40' : ''}`}>
          {nick[0]?.toUpperCase()}
        </div>
        <div
          className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-gray-800 ${
            online ? 'bg-green-500' : 'bg-gray-500'
          }`}
        />
      </div>
      <span className={`flex-1 truncate text-sm ${online ? 'text-gray-200' : 'text-gray-500'}`}>
        {nick}
      </span>
      {hover && (
        <button
          onClick={() => onRemove(nick)}
          className="rounded p-0.5 text-gray-500 hover:text-red-400"
          title="Remove friend"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
          </svg>
        </button>
      )}
    </div>
  )
}
