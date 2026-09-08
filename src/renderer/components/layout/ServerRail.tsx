import { useState } from 'react'
import { useServerStore } from '../../stores/serverStore'
import { useChannelStore } from '../../stores/channelStore'
import { useUIStore } from '../../stores/uiStore'
import { SwitchboardIcon } from '../common/SwitchboardIcon'
import { ServerMenu } from '../server/ServerMenu'
import { isChannelName } from '@shared/constants'
import { nickColor } from '../../utils/nickColor'

type ConnectionStatus = 'connected' | 'connecting' | 'disconnected'

/**
 * Height of the pill on the left edge of a rail icon.
 *
 * The pill is the whole story of the rail at a glance: a full bar for the
 * server you are looking at, a dot for one with something unread, and a short
 * bar under the cursor.
 */
function pillHeight(active: boolean, unread: boolean): string {
  if (active) return 'h-10'
  if (unread) return 'h-2 group-hover:h-5'
  return 'h-0 group-hover:h-5'
}

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
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; serverId: string } | null>(
    null
  )

  // Count total unread DMs across all servers
  const totalDmUnread = Object.values(allChannels).reduce((total, chs) => {
    return (
      total +
      chs
        .filter((ch) => !isChannelName(ch.name) && ch.name !== '*' && !ch.muted)
        .reduce((sum, ch) => sum + ch.unreadCount, 0)
    )
  }, 0)

  const handleSwitchboardClick = () => {
    useUIStore.getState().setDmMode(true)
  }

  return (
    <div className="flex w-[72px] shrink-0 flex-col items-center bg-gray-950 py-3 no-select">
      {/* Direct messages */}
      <RailItem
        active={dmMode}
        unread={totalDmUnread > 0}
        badge={dmMode ? 0 : totalDmUnread}
        label="Direct Messages"
        onClick={handleSwitchboardClick}
      >
        <span
          className={`flex h-full w-full items-center justify-center transition-colors ${
            dmMode
              ? 'bg-indigo-500 text-white'
              // Lighter than the server badges beneath it: at 30px the logo's
              // detail disappears into a dark tile, and this is the one item on
              // the rail that has no colour of its own to be found by.
              : 'bg-gray-600 text-gray-200 group-hover:bg-indigo-500 group-hover:text-white'
          }`}
        >
          <SwitchboardIcon size={30} bg="transparent" fg="currentColor" />
        </span>
      </RailItem>

      <RailSeparator />

      {/* Servers */}
      <div className="flex w-full flex-col items-center gap-2 overflow-y-auto scrollbar-none">
        {servers.map((server) => {
          const isActive = server.id === activeServerId && !dmMode
          const status: ConnectionStatus = connectionStatus[server.id] || 'disconnected'
          const initial = server.name.charAt(0).toUpperCase()
          const iconUrl = networkIcons[server.id]
          const isMuted = mutedServers[server.id] !== undefined
          const serverChannels = allChannels[server.id] || []

          // DM unread shows on the Switchboard icon instead, and a muted channel
          // should never light up its server.
          const channelOnly = serverChannels.filter(
            (ch) => (isChannelName(ch.name) || ch.name === '*') && !ch.muted
          )
          const totalMentions = channelOnly.reduce((sum, ch) => sum + ch.mentionCount, 0)
          const hasUnread = !isMuted && channelOnly.some((ch) => ch.unreadCount > 0)

          return (
            <RailItem
              key={server.id}
              active={isActive}
              unread={hasUnread}
              badge={totalMentions}
              label={server.name}
              sublabel={STATUS_LABEL[status]}
              status={status}
              onClick={() => {
                setActiveServer(server.id)
                useUIStore.getState().setDmMode(false)
              }}
              onContextMenu={(e) => {
                e.preventDefault()
                setContextMenu({ x: e.clientX, y: e.clientY, serverId: server.id })
              }}
            >
              <span
                className={`flex h-full w-full items-center justify-center overflow-hidden text-lg font-semibold text-white transition-opacity ${
                  iconUrl ? 'bg-gray-700' : nickColor(server.name)
                } ${status === 'connected' ? '' : 'opacity-50 grayscale'}`}
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
                ) : (
                  initial
                )}
              </span>
            </RailItem>
          )
        })}

        {servers.length > 0 && <RailSeparator />}

        {/* Add a server */}
        <RailItem label="Add a server" onClick={() => openModal('add-server')}>
          <span className="flex h-full w-full items-center justify-center bg-gray-800 text-green-400 transition-colors group-hover:bg-green-600 group-hover:text-white">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />
            </svg>
          </span>
        </RailItem>
      </div>

      {/* Server context menu */}
      {contextMenu && (
        <ServerMenu
          serverId={contextMenu.serverId}
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  )
}

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  connected: 'Connected',
  connecting: 'Connecting…',
  disconnected: 'Not connected'
}

const STATUS_DOT: Record<ConnectionStatus, string> = {
  connected: 'bg-green-500',
  connecting: 'bg-yellow-500',
  disconnected: 'bg-gray-600'
}

function RailSeparator() {
  return <div className="my-2 h-0.5 w-8 shrink-0 rounded-full bg-gray-800" />
}

interface RailItemProps {
  children: React.ReactNode
  label: string
  sublabel?: string
  active?: boolean
  unread?: boolean
  badge?: number
  status?: ConnectionStatus
  onClick: () => void
  onContextMenu?: (e: React.MouseEvent) => void
}

/**
 * One 48px icon in the rail, with Discord's pill/tooltip/badge furniture.
 */
function RailItem({
  children,
  label,
  sublabel,
  active = false,
  unread = false,
  badge = 0,
  status,
  onClick,
  onContextMenu
}: RailItemProps) {
  return (
    <div className="group relative shrink-0 py-0.5">
      {/* Left edge pill */}
      <span
        className={`absolute -left-3 top-1/2 w-1 -translate-y-1/2 rounded-r-full bg-gray-100 transition-all duration-200 ${pillHeight(
          active,
          unread
        )}`}
      />

      <button
        onClick={onClick}
        onContextMenu={onContextMenu}
        aria-label={label}
        className={`block h-12 w-12 overflow-hidden transition-[border-radius] duration-200 ${
          active ? 'rounded-2xl' : 'rounded-[24px] group-hover:rounded-2xl'
        }`}
      >
        {children}
      </button>

      {/* Mention badge */}
      {badge > 0 && (
        <span className="pointer-events-none absolute -bottom-0.5 -right-0.5 flex h-5 min-w-[20px] items-center justify-center rounded-full border-[3px] border-gray-950 bg-red-500 px-1 text-[11px] font-bold leading-none text-white">
          {badge > 99 ? '99+' : badge}
        </span>
      )}

      {/* Connection status */}
      {status && badge === 0 && (
        <span
          className={`pointer-events-none absolute bottom-0 right-0 h-3.5 w-3.5 rounded-full border-[3px] border-gray-950 ${STATUS_DOT[status]}`}
        />
      )}

      {/* Tooltip */}
      <div className="pointer-events-none absolute left-[60px] top-1/2 z-50 -translate-y-1/2 scale-95 whitespace-nowrap rounded-md bg-gray-950 px-3 py-2 text-sm font-semibold text-gray-100 opacity-0 shadow-xl transition-all duration-100 group-hover:scale-100 group-hover:opacity-100">
        {label}
        {sublabel && <span className="ml-2 font-normal text-gray-400">{sublabel}</span>}
        <span className="absolute -left-1 top-1/2 h-2 w-2 -translate-y-1/2 rotate-45 bg-gray-950" />
      </div>
    </div>
  )
}
