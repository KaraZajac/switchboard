import { useState, useCallback, useMemo } from 'react'
import { useServerStore } from '../../stores/serverStore'
import { useChannelStore } from '../../stores/channelStore'
import { ContextMenu, type ContextMenuItem } from '../common/ContextMenu'
import { ChannelBrowser } from '../channel/ChannelBrowser'
import { isChannelName } from '@shared/constants'

const EMPTY_CHANNELS: { name: string; serverId: string; topic: string | null; topicSetBy: string | null; unreadCount: number; mentionCount: number; muted: boolean }[] = []

interface ChannelContextState {
  x: number
  y: number
  channelName: string
  muted: boolean
}

export function ChannelSidebar() {
  const activeServerId = useServerStore((s) => s.activeServerId)
  const servers = useServerStore((s) => s.servers)
  const allChannels = useChannelStore((s) =>
    activeServerId ? s.channels[activeServerId] ?? EMPTY_CHANNELS : EMPTY_CHANNELS
  )
  const channels = useMemo(
    () => allChannels.filter((ch) => isChannelName(ch.name)),
    [allChannels]
  )
  const activeChannel = useChannelStore((s) =>
    activeServerId ? s.activeChannel[activeServerId] ?? null : null
  )
  const connectionStatus = useServerStore((s) =>
    activeServerId ? s.connectionStatus[activeServerId] ?? 'disconnected' : 'disconnected'
  )

  const server = servers.find((s) => s.id === activeServerId)
  const [contextMenu, setContextMenu] = useState<ChannelContextState | null>(null)
  const [showBrowser, setShowBrowser] = useState(false)

  const handleContextMenu = useCallback((e: React.MouseEvent, channelName: string, muted: boolean) => {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, channelName, muted })
  }, [])

  const handleLeaveChannel = useCallback((channelName: string) => {
    if (!activeServerId) return
    window.switchboard.invoke('channel:part', activeServerId, channelName)
    useChannelStore.getState().removeChannel(activeServerId, channelName)
  }, [activeServerId])

  const handleToggleMute = useCallback((channelName: string) => {
    if (!activeServerId) return
    useChannelStore.getState().toggleMute(activeServerId, channelName)
  }, [activeServerId])

  const handleChannelClick = (name: string) => {
    if (!activeServerId) return
    useChannelStore.getState().setActiveChannel(activeServerId, name)
    useChannelStore.getState().clearUnread(activeServerId, name)
  }

  const handleConnect = () => {
    if (!activeServerId) return
    useServerStore.getState().setConnectionStatus(activeServerId, 'connecting')
    window.switchboard.invoke('server:connect', activeServerId)
  }

  const handleDisconnect = () => {
    if (!activeServerId) return
    window.switchboard.invoke('server:disconnect', activeServerId)
  }

  return (
    <div className="flex w-60 flex-col bg-gray-800 no-select">
      {/* Server name header */}
      <div className="flex h-12 items-center justify-between border-b border-gray-900 px-4 shadow-sm">
        <span className="truncate font-semibold">{server?.name || 'No Server'}</span>
        {connectionStatus === 'connected' ? (
          <button
            onClick={handleDisconnect}
            className="text-xs text-gray-400 hover:text-red-400"
            title="Disconnect"
          >
            Disconnect
          </button>
        ) : (
          <button
            onClick={handleConnect}
            className="text-xs text-gray-400 hover:text-green-400"
            title="Connect"
          >
            {connectionStatus === 'connecting' ? 'Connecting...' : 'Connect'}
          </button>
        )}
      </div>

      {/* Channel list */}
      <div className="flex-1 overflow-y-auto px-2 py-2">
        {(channels.length > 0 || connectionStatus === 'connected') && (
          <div className="mb-1 flex items-center justify-between px-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">
              Channels
            </span>
            {connectionStatus === 'connected' && (
              <button
                onClick={() => setShowBrowser(true)}
                className="rounded p-0.5 text-gray-400 hover:bg-gray-700 hover:text-gray-200"
                title="Browse channels"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />
                </svg>
              </button>
            )}
          </div>
        )}

        {channels.map((ch) => {
          const isActive =
            activeChannel?.toLowerCase() === ch.name.toLowerCase()
          const hasUnread = ch.unreadCount > 0
          const hasMention = ch.mentionCount > 0

          return (
            <button
              key={ch.name}
              onClick={() => handleChannelClick(ch.name)}
              onContextMenu={(e) => handleContextMenu(e, ch.name, ch.muted)}
              className={`mb-0.5 flex w-full items-center justify-between rounded px-2 py-1.5 text-left transition-colors ${
                isActive
                  ? 'bg-gray-700 text-white'
                  : hasUnread && !ch.muted
                    ? 'text-gray-100 hover:bg-gray-700/50'
                    : 'text-gray-400 hover:bg-gray-700/50 hover:text-gray-200'
              }`}
            >
              <span className={`flex items-center truncate ${hasUnread && !isActive && !ch.muted ? 'font-semibold' : ''}`}>
                <span className="mr-1 text-gray-500">#</span>
                {ch.name.replace(/^#/, '')}
                {ch.muted && (
                  <svg className="ml-1 h-3 w-3 text-gray-500" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51A8.796 8.796 0 0 0 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06a8.99 8.99 0 0 0 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z" />
                  </svg>
                )}
              </span>

              {hasMention && (
                <span className="ml-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-xs font-bold text-white">
                  {ch.mentionCount}
                </span>
              )}
            </button>
          )
        })}

        {channels.length === 0 && connectionStatus === 'connected' && (
          <p className="px-2 py-4 text-center text-sm text-gray-500">
            No channels yet. Join one with /join #channel
          </p>
        )}

        {connectionStatus !== 'connected' && (
          <p className="px-2 py-4 text-center text-sm text-gray-500">
            {connectionStatus === 'connecting'
              ? 'Connecting...'
              : 'Not connected'}
          </p>
        )}
      </div>

      {/* Channel browser */}
      {showBrowser && <ChannelBrowser onClose={() => setShowBrowser(false)} />}

      {/* Channel context menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          items={[
            {
              label: contextMenu.muted ? 'Unmute Channel' : 'Mute Channel',
              onClick: () => handleToggleMute(contextMenu.channelName)
            },
            { label: '', onClick: () => {}, separator: true },
            {
              label: 'Leave Channel',
              onClick: () => handleLeaveChannel(contextMenu.channelName),
              danger: true
            }
          ]}
        />
      )}
    </div>
  )
}
