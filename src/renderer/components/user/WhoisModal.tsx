import { Modal } from '../common/Modal'
import { useUIStore } from '../../stores/uiStore'

export function WhoisModal() {
  const closeModal = useUIStore((s) => s.closeModal)
  const data = useUIStore((s) => s.whoisData)

  if (!data) return null

  const fields: { label: string; value: string | undefined }[] = [
    { label: 'Nickname', value: data.nick },
    { label: 'Username', value: data.user },
    { label: 'Hostname', value: data.host },
    { label: 'Real Name', value: data.realname },
    { label: 'Account', value: data.account },
    { label: 'Server', value: data.server ? `${data.server}${data.serverInfo ? ` (${data.serverInfo})` : ''}` : undefined },
    { label: 'Channels', value: data.channels },
    { label: 'Idle', value: data.idle ? formatIdle(parseInt(data.idle)) : undefined },
    { label: 'Sign-on', value: data.signon ? new Date(parseInt(data.signon) * 1000).toLocaleString() : undefined }
  ]

  return (
    <Modal title={`User Info — ${data.nick}`} onClose={closeModal}>
      <div className="space-y-3">
        {/* Avatar and badges */}
        <div className="flex items-center gap-3">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-gray-700 text-2xl font-bold text-gray-200">
            {data.nick.charAt(0).toUpperCase()}
          </div>
          <div>
            <div className="text-lg font-semibold text-gray-100">{data.nick}</div>
            <div className="flex gap-2">
              {data.isOperator && (
                <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-xs font-semibold text-amber-400">
                  IRC Operator
                </span>
              )}
              {data.isBot && (
                <span className="rounded bg-indigo-500/20 px-1.5 py-0.5 text-xs font-semibold text-indigo-400">
                  Bot
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Fields */}
        <div className="space-y-2 rounded bg-gray-900 p-3">
          {fields
            .filter((f) => f.value)
            .map((f) => (
              <div key={f.label} className="flex items-start gap-3">
                <span className="w-24 flex-shrink-0 text-xs font-semibold uppercase tracking-wide text-gray-400">
                  {f.label}
                </span>
                <span className="break-all text-sm text-gray-200">{f.value}</span>
              </div>
            ))}
        </div>
      </div>
    </Modal>
  )
}

function formatIdle(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return `${h}h ${m}m`
}
