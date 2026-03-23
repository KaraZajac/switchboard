import { useUIStore } from '../../stores/uiStore'
import { useChannelStore } from '../../stores/channelStore'

export function ToastContainer() {
  const toasts = useUIStore((s) => s.toasts)
  const removeToast = useUIStore((s) => s.removeToast)

  if (toasts.length === 0) return null

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="flex items-start gap-3 rounded-lg border border-gray-600 bg-gray-800 px-4 py-3 shadow-lg animate-in slide-in-from-right"
          style={{ minWidth: 280, maxWidth: 380 }}
        >
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-gray-100">{toast.title}</div>
            <div className="mt-0.5 text-sm text-gray-400">{toast.body}</div>
            {toast.action && (
              <button
                onClick={() => {
                  const { serverId, channel } = toast.action!
                  window.switchboard.invoke('channel:join', serverId, channel)
                  useChannelStore.getState().addChannel(serverId, channel)
                  useChannelStore.getState().setActiveChannel(serverId, channel)
                  removeToast(toast.id)
                }}
                className="mt-2 rounded bg-indigo-500 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-400"
              >
                {toast.action.label}
              </button>
            )}
          </div>
          <button
            onClick={() => removeToast(toast.id)}
            className="text-gray-500 hover:text-gray-300"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  )
}
