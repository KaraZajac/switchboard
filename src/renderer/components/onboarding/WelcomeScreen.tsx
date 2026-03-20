import { SwitchboardIcon } from '../common/SwitchboardIcon'
import { useUIStore } from '../../stores/uiStore'

export function WelcomeScreen() {
  const openModal = useUIStore((s) => s.openModal)

  return (
    <div className="flex h-full w-full flex-col items-center justify-center bg-gray-900 text-gray-100">
      <SwitchboardIcon fg="#818cf8" size={96} className="mb-6" />

      <h1 className="mb-2 text-3xl font-bold text-white">Welcome to Switchboard</h1>
      <p className="mb-8 max-w-md text-center text-gray-400">
        A modern IRC client with full IRCv3 support. Connect to your favorite
        networks and start chatting.
      </p>

      <button
        onClick={() => openModal('add-server')}
        className="rounded-lg bg-indigo-600 px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-indigo-500"
      >
        Add Your First Server
      </button>

      <div className="mt-12 max-w-sm space-y-4 text-sm text-gray-500">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 text-indigo-400">1</span>
          <span>Add a server (e.g. <code className="text-gray-400">irc.libera.chat</code>)</span>
        </div>
        <div className="flex items-start gap-3">
          <span className="mt-0.5 text-indigo-400">2</span>
          <span>Join channels to start chatting</span>
        </div>
        <div className="flex items-start gap-3">
          <span className="mt-0.5 text-indigo-400">3</span>
          <span>Use <kbd className="rounded bg-gray-800 px-1.5 py-0.5 text-xs text-gray-300">Ctrl+K</kbd> to quickly switch between channels</span>
        </div>
      </div>
    </div>
  )
}
