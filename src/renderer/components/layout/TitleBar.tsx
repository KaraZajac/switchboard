import { useServerStore } from '../../stores/serverStore'
import { useChannelStore } from '../../stores/channelStore'
import { useUIStore } from '../../stores/uiStore'

const EMPTY_CHANNELS: { name: string; topic: string | null }[] = []

export function TitleBar() {
  const activeServerId = useServerStore((s) => s.activeServerId)
  const activeChannel = useChannelStore((s) =>
    activeServerId ? s.activeChannel[activeServerId] ?? null : null
  )
  const channels = useChannelStore((s) =>
    activeServerId ? s.channels[activeServerId] ?? EMPTY_CHANNELS : EMPTY_CHANNELS
  )
  const showUserList = useUIStore((s) => s.showUserList)

  const channelInfo = channels.find(
    (ch) => ch.name.toLowerCase() === activeChannel?.toLowerCase()
  )

  return (
    <div
      className="flex h-12 items-center justify-between border-b border-gray-900 px-4 shadow-sm"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      <div className="flex items-center gap-2">
        {activeChannel && (
          <>
            <span className="text-xl text-gray-500">#</span>
            <span className="font-semibold text-gray-100">
              {activeChannel.replace(/^#/, '')}
            </span>
            {channelInfo?.topic && (
              <>
                <span className="mx-2 text-gray-600">|</span>
                <span className="truncate text-sm text-gray-400">{channelInfo.topic}</span>
              </>
            )}
          </>
        )}
      </div>

      <div className="flex items-center gap-2" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        {/* Toggle user list */}
        <button
          onClick={() => useUIStore.getState().toggleUserList()}
          className={`rounded p-1.5 transition-colors ${
            showUserList ? 'text-gray-100' : 'text-gray-400'
          } hover:bg-gray-700`}
          title="Toggle member list"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z" />
          </svg>
        </button>

        {/* Settings */}
        <button
          onClick={() => useUIStore.getState().openModal('settings')}
          className="rounded p-1.5 text-gray-400 transition-colors hover:bg-gray-700 hover:text-gray-100"
          title="Settings"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.49.49 0 0 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.07.62-.07.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z" />
          </svg>
        </button>
      </div>
    </div>
  )
}
