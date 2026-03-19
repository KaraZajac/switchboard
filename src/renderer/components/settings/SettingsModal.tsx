import { useState } from 'react'
import { Modal } from '../common/Modal'
import { useUIStore } from '../../stores/uiStore'
import { useServerStore } from '../../stores/serverStore'
import type { ServerConfig } from '@shared/types/server'

type Tab = 'servers' | 'appearance'

export function SettingsModal() {
  const closeModal = useUIStore((s) => s.closeModal)
  const [activeTab, setActiveTab] = useState<Tab>('servers')

  return (
    <Modal title="Settings" onClose={closeModal} width="max-w-2xl">
      <div className="flex gap-6">
        {/* Sidebar */}
        <div className="w-40 flex-shrink-0">
          <nav className="space-y-1">
            {(['servers', 'appearance'] as Tab[]).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`w-full rounded px-3 py-1.5 text-left text-sm capitalize ${
                  activeTab === tab
                    ? 'bg-gray-700 text-gray-100'
                    : 'text-gray-400 hover:bg-gray-700/50 hover:text-gray-200'
                }`}
              >
                {tab}
              </button>
            ))}
          </nav>
        </div>

        {/* Content */}
        <div className="flex-1">
          {activeTab === 'servers' && <ServersTab />}
          {activeTab === 'appearance' && <AppearanceTab />}
        </div>
      </div>
    </Modal>
  )
}

function ServersTab() {
  const servers = useServerStore((s) => s.servers)
  const removeServer = useServerStore((s) => s.removeServer)

  const handleRemove = async (id: string) => {
    await window.switchboard.invoke('server:remove', id)
    removeServer(id)
  }

  return (
    <div>
      <h3 className="mb-3 text-sm font-semibold text-gray-300">Configured Servers</h3>
      {servers.length === 0 && (
        <p className="text-sm text-gray-500">No servers configured yet.</p>
      )}
      <div className="space-y-2">
        {servers.map((server) => (
          <div
            key={server.id}
            className="flex items-center justify-between rounded bg-gray-900 px-4 py-3"
          >
            <div>
              <div className="font-medium text-gray-200">{server.name}</div>
              <div className="text-xs text-gray-500">
                {server.host}:{server.port} {server.tls ? '(TLS)' : ''}
                {server.saslMechanism && ` | SASL ${server.saslMechanism}`}
              </div>
            </div>
            <button
              onClick={() => handleRemove(server.id)}
              className="rounded px-2 py-1 text-xs text-red-400 hover:bg-red-500/10 hover:text-red-300"
            >
              Remove
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

function AppearanceTab() {
  const theme = useUIStore((s) => s.theme)
  const toggleTheme = useUIStore((s) => s.toggleTheme)
  const compactMode = useUIStore((s) => s.compactMode)
  const setCompactMode = useUIStore((s) => s.setCompactMode)

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-gray-300">Appearance</h3>

      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm text-gray-200">Theme</div>
          <div className="text-xs text-gray-500">Switch between dark and light mode</div>
        </div>
        <button
          onClick={toggleTheme}
          className="rounded bg-gray-700 px-3 py-1.5 text-sm text-gray-200 hover:bg-gray-600"
        >
          {theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
        </button>
      </div>

      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm text-gray-200">Compact Mode</div>
          <div className="text-xs text-gray-500">Reduce spacing between messages</div>
        </div>
        <label className="relative inline-flex cursor-pointer items-center">
          <input
            type="checkbox"
            checked={compactMode}
            onChange={(e) => setCompactMode(e.target.checked)}
            className="peer sr-only"
          />
          <div className="peer h-6 w-11 rounded-full bg-gray-600 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all peer-checked:bg-indigo-500 peer-checked:after:translate-x-full" />
        </label>
      </div>
    </div>
  )
}
