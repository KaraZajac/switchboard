import { useServerStore } from '../../stores/serverStore'
import { useChannelStore } from '../../stores/channelStore'
import { isChannelName } from '@shared/constants'

interface DMEntry {
  serverId: string
  serverName: string
  nick: string
  unreadCount: number
  mentionCount: number
}

export function DMSidebar() {
  const servers = useServerStore((s) => s.servers)
  const allChannels = useChannelStore((s) => s.channels)
  const activeServerId = useServerStore((s) => s.activeServerId)
  const activeChannel = useChannelStore((s) =>
    activeServerId ? s.activeChannel[activeServerId] ?? null : null
  )

  // Collect all DMs across all servers
  const dms: DMEntry[] = []
  for (const server of servers) {
    const channels = allChannels[server.id] || []
    for (const ch of channels) {
      if (!isChannelName(ch.name) && ch.name !== '*') {
        dms.push({
          serverId: server.id,
          serverName: server.name,
          nick: ch.name,
          unreadCount: ch.unreadCount,
          mentionCount: ch.mentionCount
        })
      }
    }
  }

  const handleDMClick = (serverId: string, nick: string) => {
    useServerStore.getState().setActiveServer(serverId)
    useChannelStore.getState().setActiveChannel(serverId, nick)
    useChannelStore.getState().clearUnread(serverId, nick)
  }

  const handleClose = (serverId: string, nick: string) => {
    useChannelStore.getState().removeChannel(serverId, nick)
  }

  return (
    <div className="flex w-60 flex-col bg-gray-800 no-select">
      {/* Header */}
      <div className="flex h-12 items-center border-b border-gray-900 px-4 shadow-sm">
        <span className="font-semibold">Direct Messages</span>
      </div>

      {/* DM list */}
      <div className="flex-1 overflow-y-auto px-2 py-2">
        {dms.length === 0 && (
          <p className="px-2 py-4 text-center text-sm text-gray-500">
            No conversations yet. Right-click a user to send a message.
          </p>
        )}

        {dms.map((dm) => {
          const isActive =
            dm.serverId === activeServerId &&
            activeChannel?.toLowerCase() === dm.nick.toLowerCase()
          const hasUnread = dm.unreadCount > 0

          return (
            <div key={`${dm.serverId}:${dm.nick}`} className="group relative">
              <button
                onClick={() => handleDMClick(dm.serverId, dm.nick)}
                className={`mb-0.5 flex w-full items-center gap-2 rounded px-2 py-1.5 text-left transition-colors ${
                  isActive
                    ? 'bg-gray-700 text-white'
                    : hasUnread
                      ? 'text-gray-100 hover:bg-gray-700/50'
                      : 'text-gray-400 hover:bg-gray-700/50 hover:text-gray-200'
                }`}
              >
                {/* Avatar */}
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-600 text-xs font-bold text-gray-200">
                  {dm.nick.charAt(0).toUpperCase()}
                </div>

                <div className="min-w-0 flex-1">
                  <span className={`truncate text-sm ${hasUnread && !isActive ? 'font-semibold' : ''}`}>
                    {dm.nick}
                  </span>
                  {servers.length > 1 && (
                    <div className="truncate text-xs text-gray-500">{dm.serverName}</div>
                  )}
                </div>

                {dm.mentionCount > 0 && (
                  <span className="flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
                    {dm.mentionCount}
                  </span>
                )}
              </button>

              {/* Close button on hover */}
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  handleClose(dm.serverId, dm.nick)
                }}
                className="absolute right-1 top-1/2 hidden -translate-y-1/2 rounded p-0.5 text-gray-500 hover:bg-gray-600 hover:text-gray-300 group-hover:block"
                title="Close conversation"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
                </svg>
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
