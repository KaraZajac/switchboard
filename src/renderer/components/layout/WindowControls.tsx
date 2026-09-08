import { useEffect, useState } from 'react'

const isMac = navigator.platform.toUpperCase().includes('MAC')

/**
 * Minimize / maximize / close for the app-drawn window frame.
 *
 * The window is created with its native frame hidden, so without these there is
 * no way to minimize or close it from the app itself. macOS keeps its own
 * traffic lights, so nothing is drawn there.
 */
export function WindowControls() {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    if (isMac) return
    const api = window.switchboard
    api.invoke('window:is-maximized').then(setMaximized).catch(() => {})
    return api.on('window:maximized', ({ maximized: next }) => setMaximized(next))
  }, [])

  if (isMac) return null

  return (
    <div
      className="flex h-full items-stretch no-select"
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
    >
      <WindowButton
        label="Minimize"
        onClick={() => window.switchboard.invoke('window:minimize')}
      >
        <rect x="3" y="7.5" width="10" height="1" />
      </WindowButton>

      <WindowButton
        label={maximized ? 'Restore' : 'Maximize'}
        onClick={() =>
          window.switchboard
            .invoke('window:maximize')
            .then(setMaximized)
            .catch(() => {})
        }
      >
        {maximized ? (
          <>
            <rect x="3" y="5" width="7" height="7" fill="none" stroke="currentColor" />
            <path d="M5.5 5V3.5H12.5V10.5H11" fill="none" stroke="currentColor" />
          </>
        ) : (
          <rect x="3.5" y="3.5" width="9" height="9" fill="none" stroke="currentColor" />
        )}
      </WindowButton>

      <WindowButton
        label="Close"
        onClick={() => window.switchboard.invoke('window:close')}
        danger
      >
        <path
          d="M4 4l8 8M12 4l-8 8"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinecap="round"
        />
      </WindowButton>
    </div>
  )
}

function WindowButton({
  children,
  label,
  onClick,
  danger = false
}: {
  children: React.ReactNode
  label: string
  onClick: () => void
  danger?: boolean
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`flex w-12 items-center justify-center text-gray-400 transition-colors ${
        danger ? 'hover:bg-red-500 hover:text-white' : 'hover:bg-gray-700 hover:text-gray-100'
      }`}
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
        {children}
      </svg>
    </button>
  )
}
