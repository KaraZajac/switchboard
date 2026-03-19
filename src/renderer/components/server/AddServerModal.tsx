import { useState } from 'react'
import { Modal } from '../common/Modal'
import { useUIStore } from '../../stores/uiStore'
import { useServerStore } from '../../stores/serverStore'
import type { ServerConfig } from '@shared/types/server'
import type { SASLMechanism } from '@shared/types/irc'
import {
  DEFAULT_PORT_TLS,
  DEFAULT_PORT,
  DEFAULT_NICK,
  DEFAULT_USERNAME,
  DEFAULT_REALNAME
} from '@shared/constants'

interface AddServerModalProps {
  editServer?: ServerConfig
}

export function AddServerModal({ editServer }: AddServerModalProps = {}) {
  const closeModal = useUIStore((s) => s.closeModal)
  const addServer = useServerStore((s) => s.addServer)
  const updateServer = useServerStore((s) => s.updateServer)

  const isEdit = !!editServer

  const [name, setName] = useState(editServer?.name ?? '')
  const [host, setHost] = useState(editServer?.host ?? '')
  const [port, setPort] = useState((editServer?.port ?? DEFAULT_PORT_TLS).toString())
  const [tls, setTls] = useState(editServer?.tls ?? true)
  const [nick, setNick] = useState(editServer?.nick ?? DEFAULT_NICK)
  const [username, setUsername] = useState(editServer?.username ?? DEFAULT_USERNAME)
  const [realname, setRealname] = useState(editServer?.realname ?? DEFAULT_REALNAME)
  const [password, setPassword] = useState(editServer?.password ?? '')
  const [saslMechanism, setSaslMechanism] = useState<string>(editServer?.saslMechanism ?? '')
  const [saslUsername, setSaslUsername] = useState(editServer?.saslUsername ?? '')
  const [saslPassword, setSaslPassword] = useState(editServer?.saslPassword ?? '')
  const [autoConnect, setAutoConnect] = useState(editServer?.autoConnect ?? false)
  const [autoJoin, setAutoJoin] = useState(editServer?.autoJoin?.join(', ') ?? '')
  const [websocketUrl, setWebsocketUrl] = useState(editServer?.websocketUrl ?? '')
  const [showAdvanced, setShowAdvanced] = useState(isEdit)
  const [error, setError] = useState<string | null>(null)

  const handleTlsToggle = (checked: boolean) => {
    setTls(checked)
    if (!isEdit) {
      setPort(checked ? DEFAULT_PORT_TLS.toString() : DEFAULT_PORT.toString())
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !host.trim() || !nick.trim()) return

    setError(null)

    const config = {
      name: name.trim(),
      host: host.trim(),
      port: parseInt(port) || DEFAULT_PORT_TLS,
      tls,
      nick: nick.trim(),
      username: username.trim() || nick.trim(),
      realname: realname.trim() || nick.trim(),
      password: password || null,
      saslMechanism: (saslMechanism as SASLMechanism) || null,
      saslUsername: saslUsername || null,
      saslPassword: saslPassword || null,
      autoConnect,
      autoJoin: autoJoin
        .split(',')
        .map((ch) => ch.trim())
        .filter(Boolean),
      websocketUrl: websocketUrl.trim() || null
    }

    try {
      if (isEdit && editServer) {
        await window.switchboard.invoke('server:update', editServer.id, config as never)
        updateServer(editServer.id, config)
      } else {
        const id = await window.switchboard.invoke('server:add', config as never)
        addServer({ ...config, id, sortOrder: 0 } as never)
      }
      closeModal()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save server')
    }
  }

  return (
    <Modal title={isEdit ? 'Edit Server' : 'Add Server'} onClose={closeModal}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Server info */}
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <label className="mb-1 block text-sm font-medium text-gray-300">
              Server Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Libera Chat"
              className="w-full rounded bg-gray-900 px-3 py-2 text-gray-100 outline-none ring-1 ring-gray-700 focus:ring-indigo-500"
              required
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-300">
              Host
            </label>
            <input
              type="text"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder="irc.libera.chat"
              className="w-full rounded bg-gray-900 px-3 py-2 text-gray-100 outline-none ring-1 ring-gray-700 focus:ring-indigo-500"
              required
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-300">
              Port
            </label>
            <input
              type="number"
              value={port}
              onChange={(e) => setPort(e.target.value)}
              className="w-full rounded bg-gray-900 px-3 py-2 text-gray-100 outline-none ring-1 ring-gray-700 focus:ring-indigo-500"
            />
          </div>
        </div>

        {/* TLS */}
        <label className="flex items-center gap-2 text-sm text-gray-300">
          <input
            type="checkbox"
            checked={tls}
            onChange={(e) => handleTlsToggle(e.target.checked)}
            className="h-4 w-4 rounded border-gray-600 bg-gray-900 text-indigo-500"
          />
          Use TLS/SSL (recommended)
        </label>

        {/* Nick */}
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-300">
            Nickname
          </label>
          <input
            type="text"
            value={nick}
            onChange={(e) => setNick(e.target.value)}
            placeholder="MyNick"
            className="w-full rounded bg-gray-900 px-3 py-2 text-gray-100 outline-none ring-1 ring-gray-700 focus:ring-indigo-500"
            required
          />
        </div>

        {/* Auto-join */}
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-300">
            Auto-join Channels
          </label>
          <input
            type="text"
            value={autoJoin}
            onChange={(e) => setAutoJoin(e.target.value)}
            placeholder="#general, #dev"
            className="w-full rounded bg-gray-900 px-3 py-2 text-gray-100 outline-none ring-1 ring-gray-700 focus:ring-indigo-500"
          />
          <p className="mt-1 text-xs text-gray-500">Comma-separated list of channels</p>
        </div>

        {/* Auto-connect */}
        <label className="flex items-center gap-2 text-sm text-gray-300">
          <input
            type="checkbox"
            checked={autoConnect}
            onChange={(e) => setAutoConnect(e.target.checked)}
            className="h-4 w-4 rounded border-gray-600 bg-gray-900 text-indigo-500"
          />
          Connect automatically on startup
        </label>

        {/* Advanced toggle */}
        <button
          type="button"
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="text-sm text-indigo-400 hover:text-indigo-300"
        >
          {showAdvanced ? 'Hide' : 'Show'} advanced settings
        </button>

        {showAdvanced && (
          <div className="space-y-4 rounded border border-gray-700 p-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-300">
                  Username
                </label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full rounded bg-gray-900 px-3 py-2 text-gray-100 outline-none ring-1 ring-gray-700 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-300">
                  Real Name
                </label>
                <input
                  type="text"
                  value={realname}
                  onChange={(e) => setRealname(e.target.value)}
                  className="w-full rounded bg-gray-900 px-3 py-2 text-gray-100 outline-none ring-1 ring-gray-700 focus:ring-indigo-500"
                />
              </div>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-gray-300">
                Server Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded bg-gray-900 px-3 py-2 text-gray-100 outline-none ring-1 ring-gray-700 focus:ring-indigo-500"
              />
            </div>

            {/* WebSocket */}
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-300">
                WebSocket URL (optional)
              </label>
              <input
                type="text"
                value={websocketUrl}
                onChange={(e) => setWebsocketUrl(e.target.value)}
                placeholder="wss://irc.example.com/webirc/websocket/"
                className="w-full rounded bg-gray-900 px-3 py-2 text-gray-100 outline-none ring-1 ring-gray-700 focus:ring-indigo-500"
              />
              <p className="mt-1 text-xs text-gray-500">If set, connects via WebSocket instead of TCP</p>
            </div>

            {/* SASL */}
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-300">
                SASL Authentication
              </label>
              <select
                value={saslMechanism}
                onChange={(e) => setSaslMechanism(e.target.value)}
                className="w-full rounded bg-gray-900 px-3 py-2 text-gray-100 outline-none ring-1 ring-gray-700 focus:ring-indigo-500"
              >
                <option value="">None</option>
                <option value="PLAIN">PLAIN</option>
                <option value="EXTERNAL">EXTERNAL (client cert)</option>
                <option value="SCRAM-SHA-256">SCRAM-SHA-256</option>
              </select>
            </div>

            {(saslMechanism === 'PLAIN' || saslMechanism === 'SCRAM-SHA-256') && (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-300">
                    SASL Username
                  </label>
                  <input
                    type="text"
                    value={saslUsername}
                    onChange={(e) => setSaslUsername(e.target.value)}
                    className="w-full rounded bg-gray-900 px-3 py-2 text-gray-100 outline-none ring-1 ring-gray-700 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-300">
                    SASL Password
                  </label>
                  <input
                    type="password"
                    value={saslPassword}
                    onChange={(e) => setSaslPassword(e.target.value)}
                    className="w-full rounded bg-gray-900 px-3 py-2 text-gray-100 outline-none ring-1 ring-gray-700 focus:ring-indigo-500"
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="rounded bg-red-900/50 px-3 py-2 text-sm text-red-300">{error}</div>
        )}

        {/* Submit */}
        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={closeModal}
            className="rounded px-4 py-2 text-sm text-gray-300 hover:text-gray-100"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="rounded bg-indigo-500 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-600"
          >
            {isEdit ? 'Save Changes' : 'Add Server'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
