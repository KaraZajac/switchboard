import { X } from 'lucide-react'
import { IconButton } from './IconButton'
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
            {/* break-words: a certificate fingerprint is one long token, and it wrapped nowhere */}
            <div className="mt-0.5 text-sm break-words text-gray-400">{toast.body}</div>
            {toast.detail && (
              <div className="mt-1.5 rounded bg-gray-900/70 px-2 py-1 font-mono text-[11px] leading-4 break-all text-gray-300 select-text">
                {toast.detail}
              </div>
            )}
            {toast.action && (
              <button
                onClick={() => {
                  const action = toast.action!
                  if (action.kind === 'join') {
                    window.switchboard.invoke('channel:join', action.serverId, action.channel)
                    useChannelStore.getState().addChannel(action.serverId, action.channel)
                    useChannelStore.getState().setActiveChannel(action.serverId, action.channel)
                  } else if (action.kind === 'trust') {
                    void window.switchboard.invoke(
                      'server:trust-certificate',
                      action.serverId,
                      action.fingerprint
                    )
                  } else {
                    useUIStore.getState().showAccount(action.serverId)
                  }
                  removeToast(toast.id)
                }}
                className="mt-2 rounded bg-indigo-500 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-400"
              >
                {toast.action.label}
              </button>
            )}
          </div>
          <IconButton size="sm" icon={X} label="Dismiss" className="-mr-1 -mt-1" onClick={() => removeToast(toast.id)} />
        </div>
      ))}
    </div>
  )
}
