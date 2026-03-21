import { useState } from 'react'
import { useServerStore } from '../../stores/serverStore'
import { useChannelStore } from '../../stores/channelStore'
import { useUIStore } from '../../stores/uiStore'
import { SwitchboardIcon } from '../common/SwitchboardIcon'
import { ContextMenu } from '../common/ContextMenu'
import { isChannelName } from '@shared/constants'
import { nickColor } from '../../utils/nickColor'

export function ServerRail() {
  const servers = useServerStore((s) => s.servers)
  const activeServerId = useServerStore((s) => s.activeServerId)
  const setActiveServer = useServerStore((s) => s.setActiveServer)
  const connectionStatus = useServerStore((s) => s.connectionStatus)
  const openModal = useUIStore((s) => s.openModal)
  const dmMode = useUIStore((s) => s.dmMode)
  const allChannels = useChannelStore((s) => s.channels)
  const mutedServers = useServerStore((s) => s.mutedServers)
  const networkIcons = useServerStore((s) => s.networkIcons)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; serverId: string } | null>(null)

  // Count total unread DMs across all servers
  const totalDmUnread = Object.values(allChannels).reduce((total, chs) => {
    return total + chs.filter((ch) => !isChannelName(ch.name) && ch.name !== '*').reduce((sum, ch) => sum + ch.unreadCount, 0)
  }, 0)

  const handleSwitchboardClick = () => {
    useUIStore.getState().setDmMode(true)
  }

  return (
    <div className="flex w-[72px] shrink-0 flex-col items-center gap-2 bg-gray-950 py-3 no-select">
      {/* Switchboard icon — Direct Messages */}
      <div className="group relative">
        {dmMode && (
          <div className="absolute -left-0.5 top-1/2 h-10 w-1 -translate-y-1/2 rounded-r bg-gray-100" />
        )}
        <button
          onClick={handleSwitchboardClick}
          className={`flex h-12 w-12 items-center justify-center transition-all ${
            dmMode
              ? 'rounded-xl bg-indigo-500 text-white'
              : 'rounded-2xl bg-gray-700 text-gray-100 hover:rounded-xl hover:bg-indigo-500 hover:text-white'
          }`}
          title="Direct Messages"
        >
          <SwitchboardIcon size={40} bg="transparent" fg="currentColor" />
        </button>

        {totalDmUnread > 0 && !dmMode && (
          <div className="absolute -bottom-1 -right-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
            {totalDmUnread > 99 ? '99+' : totalDmUnread}
          </div>
        )}

        {/* Tooltip */}
        <div className="pointer-events-none absolute left-16 top-1/2 z-50 -translate-y-1/2 whitespace-nowrap rounded bg-gray-900 px-3 py-1.5 text-sm font-medium text-gray-100 opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
          Direct Messages
          <div className="absolute -left-1 top-1/2 h-2 w-2 -translate-y-1/2 rotate-45 bg-gray-900" />
        </div>
      </div>

      {/* Separator */}
      <div className="mx-auto h-[2px] w-8 rounded bg-gray-800" />

      {servers.map((server) => {
        const isActive = server.id === activeServerId
        const status = connectionStatus[server.id] || 'disconnected'
        const initial = server.name.charAt(0).toUpperCase()
        const iconUrl = networkIcons[server.id]
        const serverChannels = allChannels[server.id] || []
        // Exclude DMs from server badge — those show on the Switchboard icon
        const channelOnly = serverChannels.filter((ch) => isChannelName(ch.name) || ch.name === '*')
        const totalMentions = channelOnly.reduce((sum, ch) => sum + ch.mentionCount, 0)
        const hasUnread = channelOnly.some((ch) => ch.unreadCount > 0)

        return (
          <div key={server.id} className="group relative">
            {/* Active indicator */}
            {isActive && !dmMode ? (
              <div className="absolute -left-0.5 top-1/2 h-10 w-1 -translate-y-1/2 rounded-r bg-gray-100" />
            ) : hasUnread && (
              <div className="absolute -left-0.5 top-1/2 h-2 w-1 -translate-y-1/2 rounded-r bg-gray-100" />
            )}

            <button
              onClick={() => {
                setActiveServer(server.id)
                useUIStore.getState().setDmMode(false)
              }}
              onContextMenu={(e) => {
                e.preventDefault()
                setContextMenu({ x: e.clientX, y: e.clientY, serverId: server.id })
              }}
              className={`flex h-12 w-12 items-center justify-center overflow-hidden text-base font-bold text-white transition-all ${!iconUrl ? nickColor(server.name) : 'bg-gray-700'} ${
                isActive && !dmMode
                  ? 'rounded-xl'
                  : 'rounded-2xl hover:rounded-xl'
              }`}
              title={`${server.name} (${status})`}
            >
              {iconUrl ? (
                <img
                  src={iconUrl}
                  alt={server.name}
                  className="h-full w-full object-cover"
                  referrerPolicy="no-referrer"
                  onError={(e) => {
                    ;(e.target as HTMLImageElement).style.display = 'none'
                    ;(e.target as HTMLImageElement).parentElement!.textContent = initial
                  }}
                />
              ) : initial}
            </button>

            {/* Mention badge (takes priority over status dot) */}
            {totalMentions > 0 ? (
              <div className="absolute -bottom-1 -right-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
                {totalMentions > 99 ? '99+' : totalMentions}
              </div>
            ) : (
              /* Connection status dot */
              <div
                className={`absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-gray-950 ${
                  status === 'connected'
                    ? 'bg-green-500'
                    : status === 'connecting'
                      ? 'bg-yellow-500'
                      : 'bg-gray-600'
                }`}
              />
            )}

            {/* Tooltip */}
            <div className="pointer-events-none absolute left-16 top-1/2 z-50 -translate-y-1/2 whitespace-nowrap rounded bg-gray-900 px-3 py-1.5 text-sm font-medium text-gray-100 opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
              {server.name}
              <div className="absolute -left-1 top-1/2 h-2 w-2 -translate-y-1/2 rotate-45 bg-gray-900" />
            </div>
          </div>
        )
      })}

      {/* Separator */}
      {servers.length > 0 && (
        <div className="mx-auto h-[2px] w-8 rounded bg-gray-800" />
      )}

      {/* Add server button */}
      <button
        onClick={() => openModal('add-server')}
        className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gray-800 text-xl text-green-400 transition-all hover:rounded-xl hover:bg-green-600 hover:text-white"
        title="Add a server"
      >
        +
      </button>

      {/* Server context menu */}
      {contextMenu && (() => {
        const isMuted = mutedServers[contextMenu.serverId] !== undefined
        const store = useServerStore.getState()
        return (
          <ContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            onClose={() => setContextMenu(null)}
            items={isMuted
              ? [
                  { label: 'Unmute Server', onClick: () => store.unmuteServer(contextMenu.serverId) }
                ]
              : [
                  { label: 'Mute for 15 minutes', onClick: () => store.muteServer(contextMenu.serverId, 15 * 60 * 1000) },
                  { label: 'Mute for 1 hour', onClick: () => store.muteServer(contextMenu.serverId, 60 * 60 * 1000) },
                  { label: 'Mute for 8 hours', onClick: () => store.muteServer(contextMenu.serverId, 8 * 60 * 60 * 1000) },
                  { label: 'Mute for 24 hours', onClick: () => store.muteServer(contextMenu.serverId, 24 * 60 * 60 * 1000) },
                  { label: 'Mute until turned back on', onClick: () => store.muteServer(contextMenu.serverId) }
                ]
            }
          />
        )
      })()}
    </div>
  )
}
