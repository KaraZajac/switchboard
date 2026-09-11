import { useState, useEffect } from 'react'
import { DevicesTab } from './DevicesTab'
import { Modal } from '../common/Modal'
import { useUIStore } from '../../stores/uiStore'
import type { Theme } from '../../stores/uiStore'
import { useServerStore } from '../../stores/serverStore'
import type { StorageProtection } from '@shared/types/ipc'
import { toMask, DEFAULT_SCOPE, EVERYWHERE, type IgnoreEntry, type IgnoreScope } from '@shared/ignore'

type Tab = 'servers' | 'appearance' | 'notifications' | 'ignored' | 'devices' | 'network' | 'shortcuts'

const TABS: { key: Tab; label: string }[] = [
  { key: 'servers', label: 'Servers' },
  { key: 'appearance', label: 'Appearance' },
  { key: 'notifications', label: 'Notifications' },
  { key: 'ignored', label: 'Ignored' },
  { key: 'devices', label: 'Devices' },
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
        <div className="w-40 flex-shrink-0 self-start">
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
          {activeTab === 'ignored' && <IgnoredTab />}
          {activeTab === 'devices' && <DevicesTab />}
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

interface ThemeDef {
  id: Theme
  label: string
  group: 'dark' | 'light'
  /** Preview colors: [background, surface, accent, text, secondary] */
  colors: [string, string, string, string, string]
}

const THEMES: ThemeDef[] = [
  { id: 'catppuccin-mocha', label: 'Catppuccin Mocha', group: 'dark', colors: ['#11111b', '#1e1e2e', '#89b4fa', '#cdd6f4', '#f38ba8'] },
  { id: 'catppuccin-frappe', label: 'Catppuccin Frappé', group: 'dark', colors: ['#232634', '#303446', '#8caaee', '#c6d0f5', '#e78284'] },
  { id: 'catppuccin-macchiato', label: 'Catppuccin Macchiato', group: 'dark', colors: ['#181926', '#24273a', '#8aadf4', '#cad3f5', '#ed8796'] },
  { id: 'catppuccin-latte', label: 'Catppuccin Latte', group: 'light', colors: ['#dce0e8', '#e6e9ef', '#1e66f5', '#4c4f69', '#d20f39'] },
  { id: 'dracula', label: 'Dracula', group: 'dark', colors: ['#191a21', '#282a36', '#bd93f9', '#f8f8f2', '#ff5555'] },
  { id: 'nord', label: 'Nord', group: 'dark', colors: ['#242933', '#3b4252', '#81a1c1', '#d8dee9', '#bf616a'] },
  { id: 'gruvbox', label: 'Gruvbox', group: 'dark', colors: ['#1d2021', '#32302f', '#b16286', '#ebdbb2', '#cc241d'] },
  { id: 'one-dark', label: 'One Dark', group: 'dark', colors: ['#1b1e24', '#282c34', '#61afef', '#d7dae0', '#e06c75'] },
  { id: 'rose-pine', label: 'Rosé Pine', group: 'dark', colors: ['#191724', '#26233a', '#c4a7e7', '#e0def4', '#eb6f92'] },
  { id: 'solarized-dark', label: 'Solarized Dark', group: 'dark', colors: ['#001e27', '#073642', '#6c71c4', '#b5c4c4', '#dc322f'] },
  { id: 'tokyo-night', label: 'Tokyo Night', group: 'dark', colors: ['#16161e', '#24283b', '#7aa2f7', '#c0caf5', '#f7768e'] },
  { id: 'kanagawa', label: 'Kanagawa', group: 'dark', colors: ['#16161d', '#2a2a37', '#957fb8', '#dcd7ba', '#e46876'] },
  { id: 'discord', label: 'Discord', group: 'dark', colors: ['#1a1b1e', '#313338', '#5865f2', '#f2f3f5', '#ed4245'] },
]

function AppearanceTab() {
  const theme = useUIStore((s) => s.theme)
  const setTheme = useUIStore((s) => s.setTheme)
  const compactMode = useUIStore((s) => s.compactMode)
  const setCompactMode = useUIStore((s) => s.setCompactMode)
  const fontSize = useUIStore((s) => s.fontSize)
  const setFontSize = useUIStore((s) => s.setFontSize)
  const timeFormat = useUIStore((s) => s.timeFormat)
  const setTimeFormat = useUIStore((s) => s.setTimeFormat)

  const darkThemes = THEMES.filter((t) => t.group === 'dark')
  const lightThemes = THEMES.filter((t) => t.group === 'light')

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-gray-300">Appearance</h3>

      {/* Theme picker */}
      <div>
        <div className="text-sm text-gray-200">Select Theme</div>
        <div className="mt-1 text-xs text-gray-500">Choose a color theme for Switchboard</div>

        <div className="mt-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Dark</div>
        <div className="mt-1 grid grid-cols-3 gap-2">
          {darkThemes.map((t) => (
            <ThemeCard key={t.id} theme={t} active={theme === t.id} onClick={() => setTheme(t.id)} />
          ))}
        </div>

        <div className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Light</div>
        <div className="mt-1 grid grid-cols-3 gap-2">
          {lightThemes.map((t) => (
            <ThemeCard key={t.id} theme={t} active={theme === t.id} onClick={() => setTheme(t.id)} />
          ))}
        </div>
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

function ThemeCard({ theme, active, onClick }: { theme: ThemeDef; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-lg border p-2 text-left transition-colors ${
        active
          ? 'border-indigo-500 bg-gray-700/50'
          : 'border-gray-600 bg-gray-800 hover:border-gray-500 hover:bg-gray-700/30'
      }`}
    >
      <div className="flex gap-1">
        {theme.colors.map((color, i) => (
          <div
            key={i}
            className="h-4 w-4 rounded-full"
            style={{ backgroundColor: color }}
          />
        ))}
      </div>
      <div className={`mt-1.5 truncate text-xs ${active ? 'font-medium text-gray-100' : 'text-gray-300'}`}>
        {theme.label}
      </div>
    </button>
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
  const [secrets, setSecrets] = useState<StorageProtection | null>(null)
  const [proxyType, setProxyType] = useState('none')
  const [proxyHost, setProxyHost] = useState('')
  const [proxyPort, setProxyPort] = useState('')
  const [proxyUser, setProxyUser] = useState('')
  const [proxyPass, setProxyPass] = useState('')
  const [customCaPath, setCustomCaPath] = useState('')
  const [proxySaved, setProxySaved] = useState(false)

  // Load saved settings
  useEffect(() => {
    window.switchboard.invoke('settings:get', 'proxy').then((v) => {
      if (v && typeof v === 'object') {
        const p = v as Record<string, string>
        setProxyType(p.type || 'none')
        setProxyHost(p.host || '')
        setProxyUser(p.username || '')
        setProxyPass(p.password || '')
        setProxyPort(p.port || '')
      }
    })
    window.switchboard.invoke('settings:get', 'customCaPath').then((v) => {
      if (typeof v === 'string') setCustomCaPath(v)
    })
    window.switchboard
      .invoke('app:secrets-status')
      .then(setSecrets)
      .catch(() => {})
  }, [])

  const handleSaveProxy = () => {
    window.switchboard.invoke('settings:set', 'proxy', {
      type: proxyType,
      host: proxyHost,
      port: proxyPort,
      username: proxyUser,
      password: proxyPass
    })
    setProxySaved(true)
  }

  const handleSaveCa = () => {
    window.switchboard.invoke('settings:set', 'customCaPath', customCaPath)
  }

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-gray-300">Network</h3>

      {/* What is actually protected on disk */}
      {secrets && (
        <div className="space-y-2">
          <div className="rounded border border-gray-700 bg-gray-900/50 px-3 py-2.5">
            <div className="flex items-center gap-2 text-sm text-gray-200">
              <span
                className={`h-2 w-2 rounded-full ${secrets.protected ? 'bg-green-500' : 'bg-yellow-500'}`}
              />
              Credential storage
            </div>
            <div className="mt-1 text-xs leading-relaxed text-gray-500">
              {secrets.protected
                ? `Server and SASL passwords are encrypted with your system keystore (${secrets.description}).`
                : `Passwords are not protected on this system — ${secrets.description}.`}
            </div>
          </div>

          <div className="rounded border border-gray-700 bg-gray-900/50 px-3 py-2.5">
            <div className="flex items-center gap-2 text-sm text-gray-200">
              <span
                className={`h-2 w-2 rounded-full ${secrets.databaseEncrypted ? 'bg-green-500' : 'bg-yellow-500'}`}
              />
              Message history
            </div>
            <div className="mt-1 text-xs leading-relaxed text-gray-500">
              {secrets.databaseEncrypted
                ? 'Every message, channel and server on this machine is encrypted with a key held by your system keystore. Copying the file off the disk gets nothing without the account it belongs to.'
                : 'There is no system keystore to hold a key, so history is stored unencrypted. Anything with access to this disk can read it.'}
            </div>
          </div>
        </div>
      )}

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
          <option value="socks4">SOCKS4a</option>
        </select>

        {proxyType !== 'none' && (
          <div className="space-y-2">
            <div className="flex gap-2">
              <input
                type="text"
                value={proxyHost}
                onChange={(e) => { setProxyHost(e.target.value); setProxySaved(false) }}
                placeholder="Proxy host"
                className="flex-1 rounded bg-gray-900 px-3 py-2 text-sm text-gray-100 outline-none ring-1 ring-gray-700 focus:ring-indigo-500"
              />
              <input
                type="number"
                value={proxyPort}
                onChange={(e) => { setProxyPort(e.target.value); setProxySaved(false) }}
                placeholder="Port"
                className="w-24 rounded bg-gray-900 px-3 py-2 text-sm text-gray-100 outline-none ring-1 ring-gray-700 focus:ring-indigo-500"
              />
            </div>

            {/* SOCKS5 can carry a password (RFC 1929); SOCKS4a only a name */}
            <div className="flex gap-2">
              <input
                type="text"
                value={proxyUser}
                onChange={(e) => { setProxyUser(e.target.value); setProxySaved(false) }}
                placeholder={proxyType === 'socks4' ? 'User name (optional)' : 'Username (optional)'}
                className="flex-1 rounded bg-gray-900 px-3 py-2 text-sm text-gray-100 outline-none ring-1 ring-gray-700 focus:ring-indigo-500"
              />
              {proxyType === 'socks5' && (
                <input
                  type="password"
                  value={proxyPass}
                  onChange={(e) => { setProxyPass(e.target.value); setProxySaved(false) }}
                  placeholder="Password (optional)"
                  className="flex-1 rounded bg-gray-900 px-3 py-2 text-sm text-gray-100 outline-none ring-1 ring-gray-700 focus:ring-indigo-500"
                />
              )}
              <button
                onClick={handleSaveProxy}
                className="rounded bg-indigo-500 px-3 py-2 text-sm text-white hover:bg-indigo-600"
              >
                Save
              </button>
            </div>

            <div className="text-xs leading-relaxed text-gray-500">
              {proxySaved
                ? 'Saved. Networks you are already on stay where they are — reconnect to move them onto the proxy.'
                : 'Host names are resolved by the proxy, not here, so a lookup does not go out from this machine. Applies to every network on the next connection.'}
            </div>
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


/**
 * People you have decided not to hear from.
 *
 * The list has to be visible somewhere, or the only way to undo an ignore is
 * to find the person again and right-click them — which is exactly what you
 * cannot do once they are silent. Shows what each entry covers and lets it be
 * widened, because "ignore" from a menu deliberately means the narrow thing.
 */
function IgnoredTab() {
  const servers = useServerStore((s) => s.servers)
  const [list, setList] = useState<IgnoreEntry[]>([])
  const [typed, setTyped] = useState('')
  const [network, setNetwork] = useState(EVERYWHERE)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void window.switchboard.invoke('ignore:list').then(setList)
  }, [])

  const nameOf = (id: string): string =>
    id === EVERYWHERE ? 'Everywhere' : servers.find((s) => s.id === id)?.name ?? 'a network you left'

  const add = async () => {
    setError(null)
    try {
      setList(await window.switchboard.invoke('ignore:add', typed, network, DEFAULT_SCOPE))
      setTyped('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not work')
    }
  }

  const widen = async (entry: IgnoreEntry, kind: keyof IgnoreScope, on: boolean) => {
    setList(
      await window.switchboard.invoke('ignore:add', entry.mask, entry.network, {
        ...entry.scope,
        [kind]: on
      })
    )
  }

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-gray-300">Ignored</h3>
      <p className="text-xs leading-relaxed text-gray-500">
        Nothing from anybody matching one of these reaches this client — not a message, not a
        notification, not a badge. Shared with your phone, so somebody silenced here is silent
        there too.
      </p>

      <div className="flex gap-2">
        <input
          type="text"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && typed.trim()) void add()
          }}
          placeholder="A nick, or a mask like *!*@example.org"
          className="flex-1 rounded bg-gray-900 px-3 py-2 font-mono text-sm text-gray-100 outline-none ring-1 ring-gray-700 focus:ring-indigo-500"
        />
        <select
          value={network}
          onChange={(e) => setNetwork(e.target.value)}
          className="rounded bg-gray-900 px-2 py-2 text-sm text-gray-100 outline-none ring-1 ring-gray-700 focus:ring-indigo-500"
        >
          <option value={EVERYWHERE}>Everywhere</option>
          {servers.map((server) => (
            <option key={server.id} value={server.id}>
              {server.name}
            </option>
          ))}
        </select>
        <button
          onClick={() => typed.trim() && void add()}
          disabled={!typed.trim()}
          className="rounded bg-indigo-500 px-3 py-2 text-sm text-white hover:bg-indigo-600 disabled:opacity-50"
        >
          Add
        </button>
      </div>

      {/* What a bare nick will become, before it is added */}
      {typed.trim() && toMask(typed) !== typed.trim() && (
        <p className="font-mono text-xs text-gray-500">Will be saved as {toMask(typed)}</p>
      )}

      {error && <div className="rounded bg-red-900/50 px-2 py-1.5 text-xs text-red-300">{error}</div>}

      {list.length === 0 ? (
        <p className="text-sm text-gray-500">Nobody. Right-click someone to add them.</p>
      ) : (
        <div className="space-y-1">
          {[...list]
            .sort((a, b) => b.added - a.added)
            .map((entry) => (
              <div
                key={`${entry.network}:${entry.mask}`}
                className="rounded bg-gray-900/60 px-3 py-2 ring-1 ring-gray-800"
              >
                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-mono text-sm text-gray-100">{entry.mask}</div>
                    <div className="text-xs text-gray-500">{nameOf(entry.network)}</div>
                  </div>
                  <button
                    onClick={async () =>
                      setList(
                        await window.switchboard.invoke('ignore:remove', entry.mask, entry.network)
                      )
                    }
                    className="shrink-0 rounded px-2 py-1 text-xs text-gray-400 hover:bg-gray-700 hover:text-gray-100"
                  >
                    Remove
                  </button>
                </div>

                {/*
                  Joins and parts are deliberately not here: they are what
                  keeps the member list right, and hiding them is a decision
                  about every arrival rather than about one person.
                */}
                <div className="mt-1.5 flex gap-3 text-xs text-gray-400">
                  {([
                    ['messages', 'Messages'],
                    ['requests', 'Invites and CTCP']
                  ] as [keyof IgnoreScope, string][]).map(([kind, label]) => (
                    <label key={kind} className="flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={entry.scope[kind]}
                        onChange={(e) => void widen(entry, kind, e.target.checked)}
                        className="accent-indigo-500"
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </div>
            ))}
        </div>
      )}
    </div>
  )
}
