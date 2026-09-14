import { Plus, X } from 'lucide-react'
import { IconButton } from '../common/IconButton'
import { SectionHeader } from '../common/SectionHeader'
import { useState, useCallback } from 'react'
import { useUserStore, type MonitoredNick } from '../../stores/userStore'
import { useServerStore } from '../../stores/serverStore'
import { useChannelStore } from '../../stores/channelStore'
import { useUIStore } from '../../stores/uiStore'
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
  const [collapsed, setCollapsed] = useState(false)
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

  const handleClick = useCallback((nick: string) => {
    if (!activeServerId) return
    // Ensure a DM channel exists, then switch to it
    useChannelStore.getState().addChannel(activeServerId, nick)
    useChannelStore.getState().setActiveChannel(activeServerId, nick)
    useChannelStore.getState().clearUnread(activeServerId, nick)
    // Exit DM mode so the server sidebar shows
    useUIStore.getState().setDmMode(false)
  }, [activeServerId])

  if (connectionStatus !== 'connected') return null
  const header = (
    <SectionHeader
      label="Friends"
      collapsed={collapsed}
      onToggle={() => setCollapsed((c) => !c)}
      action={{ icon: Plus, label: 'Add friend', onClick: () => setAddingNick(true) }}
    />
  )
  if (monitoredNicks.length === 0 && !addingNick) {
    return (
      <div>
        {header}
      </div>
    )
  }

  return (
    <div>
      {header}

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

      {!collapsed && online.length > 0 && (
        <div className="mb-1">
          <span className="block px-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
            Online — {online.length}
          </span>
          {online.map((m) => (
            <FriendEntry
              key={m.nick}
              nick={m.nick}
              online
              onRemove={handleRemove}
              onClick={handleClick}
            />
          ))}
        </div>
      )}

      {!collapsed && offline.length > 0 && (
        <div className="mb-1">
          <span className="block px-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
            Offline — {offline.length}
          </span>
          {offline.map((m) => (
            <FriendEntry
              key={m.nick}
              nick={m.nick}
              online={false}
              onRemove={handleRemove}
              onClick={handleClick}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function FriendEntry({ nick, online, onRemove, onClick }: { nick: string; online: boolean; onRemove: (nick: string) => void; onClick: (nick: string) => void }) {
  const [hover, setHover] = useState(false)
  const avatarColor = nickColor(nick)

  return (
    <div
      className="group flex cursor-pointer items-center gap-2 rounded px-2 py-1 hover:bg-gray-700/50"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={() => onClick(nick)}
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
        <IconButton
          size="sm"
          icon={X}
          label="Remove friend"
          danger
          onClick={(e) => {
            e.stopPropagation()
            onRemove(nick)
          }}
        />
      )}
    </div>
  )
}
