import { useServerStore } from '../../stores/serverStore'
import { useChannelStore } from '../../stores/channelStore'

const EMPTY_CHANNELS: { name: string; serverId: string; topic: string | null; topicSetBy: string | null; unreadCount: number; mentionCount: number; muted: boolean }[] = []

export function ChannelSidebar() {
  const activeServerId = useServerStore((s) => s.activeServerId)
  const servers = useServerStore((s) => s.servers)
  const channels = useChannelStore((s) =>
    activeServerId ? s.channels[activeServerId] ?? EMPTY_CHANNELS : EMPTY_CHANNELS
  )
  const activeChannel = useChannelStore((s) =>
    activeServerId ? s.activeChannel[activeServerId] ?? null : null
  )
  const connectionStatus = useServerStore((s) =>
    activeServerId ? s.connectionStatus[activeServerId] ?? 'disconnected' : 'disconnected'
  )

  const server = servers.find((s) => s.id === activeServerId)

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
        {channels.length > 0 && (
          <div className="mb-1 px-1 text-xs font-semibold uppercase tracking-wide text-gray-400">
            Text Channels
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
              className={`mb-0.5 flex w-full items-center justify-between rounded px-2 py-1.5 text-left transition-colors ${
                isActive
                  ? 'bg-gray-700 text-white'
                  : hasUnread
                    ? 'text-gray-100 hover:bg-gray-700/50'
                    : 'text-gray-400 hover:bg-gray-700/50 hover:text-gray-200'
              }`}
            >
              <span className={`truncate ${hasUnread && !isActive ? 'font-semibold' : ''}`}>
                <span className="mr-1 text-gray-500">#</span>
                {ch.name.replace(/^#/, '')}
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
    </div>
  )
}
