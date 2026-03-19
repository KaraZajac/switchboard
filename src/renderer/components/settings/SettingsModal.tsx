import { useState } from 'react'
import { Modal } from '../common/Modal'
import { useUIStore } from '../../stores/uiStore'
import { useServerStore } from '../../stores/serverStore'

type Tab = 'servers' | 'appearance' | 'notifications' | 'network' | 'shortcuts'

const TABS: { key: Tab; label: string }[] = [
  { key: 'servers', label: 'Servers' },
  { key: 'appearance', label: 'Appearance' },
  { key: 'notifications', label: 'Notifications' },
  { key: 'network', label: 'Network' },
  { key: 'shortcuts', label: 'Shortcuts' }
]

export function SettingsModal() {
  const closeModal = useUIStore((s) => s.closeModal)
  const [activeTab, setActiveTab] = useState<Tab>('servers')

  return (
    <Modal title="Settings" onClose={closeModal} width="max-w-2xl">
      <div className="flex gap-6">
        {/* Sidebar */}
        <div className="w-40 flex-shrink-0">
          <nav className="space-y-1">
            {TABS.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`w-full rounded px-3 py-1.5 text-left text-sm ${
                  activeTab === tab.key
                    ? 'bg-gray-700 text-gray-100'
                    : 'text-gray-400 hover:bg-gray-700/50 hover:text-gray-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Content */}
        <div className="flex-1">
          {activeTab === 'servers' && <ServersTab />}
          {activeTab === 'appearance' && <AppearanceTab />}
          {activeTab === 'notifications' && <NotificationsTab />}
          {activeTab === 'network' && <NetworkTab />}
          {activeTab === 'shortcuts' && <ShortcutsTab />}
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
            <div className="flex gap-2">
              <button
                onClick={() => useUIStore.getState().setEditServerId(server.id)}
                className="rounded px-2 py-1 text-xs text-gray-400 hover:bg-gray-700 hover:text-gray-200"
              >
                Edit
              </button>
              <button
                onClick={() => handleRemove(server.id)}
                className="rounded px-2 py-1 text-xs text-red-400 hover:bg-red-500/10 hover:text-red-300"
              >
                Remove
              </button>
            </div>
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
  const fontSize = useUIStore((s) => s.fontSize)
  const setFontSize = useUIStore((s) => s.setFontSize)
  const timeFormat = useUIStore((s) => s.timeFormat)
  const setTimeFormat = useUIStore((s) => s.setTimeFormat)

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
        <ToggleSwitch checked={compactMode} onChange={setCompactMode} />
      </div>

      <div>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm text-gray-200">Font Size</div>
            <div className="text-xs text-gray-500">Chat message text size ({fontSize}px)</div>
          </div>
          <span className="text-sm text-gray-300">{fontSize}px</span>
        </div>
        <input
          type="range"
          min={12}
          max={20}
          step={1}
          value={fontSize}
          onChange={(e) => setFontSize(parseInt(e.target.value))}
          className="mt-2 w-full accent-indigo-500"
        />
        <div className="flex justify-between text-[10px] text-gray-500">
          <span>12px</span>
          <span>20px</span>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm text-gray-200">Time Format</div>
          <div className="text-xs text-gray-500">How timestamps are displayed</div>
        </div>
        <div className="flex rounded bg-gray-900 ring-1 ring-gray-700">
          <button
            onClick={() => setTimeFormat('12h')}
            className={`rounded-l px-3 py-1.5 text-xs ${
              timeFormat === '12h'
                ? 'bg-gray-700 text-gray-100'
                : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            12h
          </button>
          <button
            onClick={() => setTimeFormat('24h')}
            className={`rounded-r px-3 py-1.5 text-xs ${
              timeFormat === '24h'
                ? 'bg-gray-700 text-gray-100'
                : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            24h
          </button>
        </div>
      </div>
    </div>
  )
}

function NotificationsTab() {
  const notificationsEnabled = useUIStore((s) => s.notificationsEnabled)
  const setNotificationsEnabled = useUIStore((s) => s.setNotificationsEnabled)
  const notificationSound = useUIStore((s) => s.notificationSound)
  const setNotificationSound = useUIStore((s) => s.setNotificationSound)

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-gray-300">Notifications</h3>

      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm text-gray-200">Desktop Notifications</div>
          <div className="text-xs text-gray-500">Show notifications for mentions and PMs</div>
        </div>
        <ToggleSwitch checked={notificationsEnabled} onChange={setNotificationsEnabled} />
      </div>

      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm text-gray-200">Notification Sound</div>
          <div className="text-xs text-gray-500">Play a sound for notifications</div>
        </div>
        <ToggleSwitch checked={notificationSound} onChange={setNotificationSound} />
      </div>

      <div className="rounded bg-gray-900 p-3">
        <div className="text-xs text-gray-400">
          Per-channel mute: right-click a channel in the sidebar to mute/unmute notifications for that channel.
        </div>
      </div>
    </div>
  )
}

function NetworkTab() {
  const [proxyType, setProxyType] = useState('none')
  const [proxyHost, setProxyHost] = useState('')
  const [proxyPort, setProxyPort] = useState('')
  const [customCaPath, setCustomCaPath] = useState('')

  // Load saved settings
  useState(() => {
    window.switchboard.invoke('settings:get', 'proxy').then((v) => {
      if (v && typeof v === 'object') {
        const p = v as Record<string, string>
        setProxyType(p.type || 'none')
        setProxyHost(p.host || '')
        setProxyPort(p.port || '')
      }
    })
    window.switchboard.invoke('settings:get', 'customCaPath').then((v) => {
      if (typeof v === 'string') setCustomCaPath(v)
    })
  })

  const handleSaveProxy = () => {
    window.switchboard.invoke('settings:set', 'proxy', {
      type: proxyType,
      host: proxyHost,
      port: proxyPort
    })
  }

  const handleSaveCa = () => {
    window.switchboard.invoke('settings:set', 'customCaPath', customCaPath)
  }

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-gray-300">Network</h3>

      {/* Proxy */}
      <div>
        <div className="mb-2 text-sm text-gray-200">Proxy</div>
        <select
          value={proxyType}
          onChange={(e) => setProxyType(e.target.value)}
          className="mb-2 w-full rounded bg-gray-900 px-3 py-2 text-sm text-gray-100 outline-none ring-1 ring-gray-700 focus:ring-indigo-500"
        >
          <option value="none">No Proxy</option>
          <option value="socks5">SOCKS5</option>
          <option value="http">HTTP/HTTPS</option>
        </select>

        {proxyType !== 'none' && (
          <div className="flex gap-2">
            <input
              type="text"
              value={proxyHost}
              onChange={(e) => setProxyHost(e.target.value)}
              placeholder="Proxy host"
              className="flex-1 rounded bg-gray-900 px-3 py-2 text-sm text-gray-100 outline-none ring-1 ring-gray-700 focus:ring-indigo-500"
            />
            <input
              type="number"
              value={proxyPort}
              onChange={(e) => setProxyPort(e.target.value)}
              placeholder="Port"
              className="w-24 rounded bg-gray-900 px-3 py-2 text-sm text-gray-100 outline-none ring-1 ring-gray-700 focus:ring-indigo-500"
            />
            <button
              onClick={handleSaveProxy}
              className="rounded bg-indigo-500 px-3 py-2 text-sm text-white hover:bg-indigo-600"
            >
              Save
            </button>
          </div>
        )}
      </div>

      {/* Custom CA */}
      <div>
        <div className="mb-1 text-sm text-gray-200">Custom CA Certificate</div>
        <div className="mb-1 text-xs text-gray-500">
          Path to a PEM file with additional trusted certificates
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            value={customCaPath}
            onChange={(e) => setCustomCaPath(e.target.value)}
            placeholder="/path/to/ca-bundle.pem"
            className="flex-1 rounded bg-gray-900 px-3 py-2 text-sm text-gray-100 outline-none ring-1 ring-gray-700 focus:ring-indigo-500"
          />
          <button
            onClick={handleSaveCa}
            className="rounded bg-indigo-500 px-3 py-2 text-sm text-white hover:bg-indigo-600"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}

function ShortcutsTab() {
  const shortcuts = [
    { keys: 'Ctrl+K', action: 'Quick channel switcher' },
    { keys: 'Ctrl+F', action: 'Search messages' },
    { keys: 'Ctrl+,', action: 'Open settings' },
    { keys: 'Ctrl+N', action: 'Add server' },
    { keys: 'Enter', action: 'Send message' },
    { keys: 'Shift+Enter', action: 'New line in message' },
    { keys: 'Escape', action: 'Cancel reply / Close modal' },
    { keys: 'Tab', action: 'Complete nick / channel / command' },
    { keys: 'Up/Down', action: 'Cycle through completions' }
  ]

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-gray-300">Keyboard Shortcuts</h3>
      <div className="space-y-1">
        {shortcuts.map((s) => (
          <div key={s.keys} className="flex items-center justify-between rounded px-2 py-1.5">
            <span className="text-sm text-gray-300">{s.action}</span>
            <kbd className="rounded bg-gray-900 px-2 py-0.5 text-xs font-mono text-gray-400 ring-1 ring-gray-700">
              {s.keys}
            </kbd>
          </div>
        ))}
      </div>
    </div>
  )
}

function ToggleSwitch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="relative inline-flex cursor-pointer items-center">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="peer sr-only"
      />
      <div className="peer h-6 w-11 rounded-full bg-gray-600 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all peer-checked:bg-indigo-500 peer-checked:after:translate-x-full" />
    </label>
  )
}
