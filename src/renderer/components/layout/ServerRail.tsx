import { useServerStore } from '../../stores/serverStore'
import { useChannelStore } from '../../stores/channelStore'
import { useUIStore } from '../../stores/uiStore'
import { SwitchboardIcon } from '../common/SwitchboardIcon'
import { isChannelName } from '@shared/constants'

export function ServerRail() {
  const servers = useServerStore((s) => s.servers)
  const activeServerId = useServerStore((s) => s.activeServerId)
  const setActiveServer = useServerStore((s) => s.setActiveServer)
  const connectionStatus = useServerStore((s) => s.connectionStatus)
  const openModal = useUIStore((s) => s.openModal)
  const dmMode = useUIStore((s) => s.dmMode)
  const allChannels = useChannelStore((s) => s.channels)

  // Count total unread DMs across all servers
  const totalDmUnread = Object.values(allChannels).reduce((total, chs) => {
    return total + chs.filter((ch) => !isChannelName(ch.name) && ch.name !== '*').reduce((sum, ch) => sum + ch.unreadCount, 0)
  }, 0)

  const handleSwitchboardClick = () => {
    useUIStore.getState().setDmMode(true)
  }

  return (
    <div className="flex w-[72px] flex-col items-center gap-2 bg-gray-950 py-3 no-select">
      {/* Switchboard icon — Direct Messages */}
      <div className="group relative">
        {dmMode && (
          <div className="absolute -left-0.5 top-1/2 h-10 w-1 -translate-y-1/2 rounded-r bg-white" />
        )}
        <button
          onClick={handleSwitchboardClick}
          className={`flex h-12 w-12 items-center justify-center transition-all ${
            dmMode
              ? 'rounded-xl bg-indigo-500'
              : 'rounded-2xl bg-gray-700 hover:rounded-xl hover:bg-indigo-500'
          }`}
          title="Direct Messages"
        >
          <SwitchboardIcon size={40} bg="transparent" fg="white" />
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
        const serverChannels = allChannels[server.id] || []
        const totalMentions = serverChannels.reduce((sum, ch) => sum + ch.mentionCount, 0)
        const hasUnread = serverChannels.some((ch) => ch.unreadCount > 0)

        return (
          <div key={server.id} className="group relative">
            {/* Active indicator */}
            {isActive && !dmMode ? (
              <div className="absolute -left-0.5 top-1/2 h-10 w-1 -translate-y-1/2 rounded-r bg-white" />
            ) : hasUnread && (
              <div className="absolute -left-0.5 top-1/2 h-2 w-1 -translate-y-1/2 rounded-r bg-white" />
            )}

            <button
              onClick={() => {
                setActiveServer(server.id)
                useUIStore.getState().setDmMode(false)
              }}
              className={`flex h-12 w-12 items-center justify-center text-base font-bold transition-all ${
                isActive && !dmMode
                  ? 'rounded-xl bg-indigo-500 text-white'
                  : 'rounded-2xl bg-gray-700 text-gray-300 hover:rounded-xl hover:bg-indigo-500 hover:text-white'
              }`}
              title={`${server.name} (${status})`}
            >
              {initial}
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
    </div>
  )
}
