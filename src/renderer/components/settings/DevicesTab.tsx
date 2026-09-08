import { useCallback, useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import type { RemoteLinkStatus, SessionSnapshot, VaultStatusInfo } from '@shared/types/ipc'
import { encodePairingUri } from '@shared/pairing'

/**
 * Pairing and device management for the remote link.
 *
 * A phone joins by scanning the ticket and typing the code that is on screen
 * while the window is open — after that it is recognised by its key, and this
 * is where you take that recognition away again.
 */
export function DevicesTab() {
  const [status, setStatus] = useState<RemoteLinkStatus | null>(null)
  const [vault, setVault] = useState<VaultStatusInfo | null>(null)
  const [session, setSession] = useState<SessionSnapshot | null>(null)
  const [busy, setBusy] = useState(false)
  const [now, setNow] = useState(Date.now())

  const refresh = useCallback(async () => {
    const [link, vaultStatus, sessionState] = await Promise.all([
      window.switchboard.invoke('remote:status'),
      window.switchboard.invoke('vault:status'),
      window.switchboard.invoke('session:state')
    ])
    setStatus(link)
    setVault(vaultStatus)
    setSession(sessionState)
  }, [])

  useEffect(() => {
    refresh().catch(() => {})
    const poll = setInterval(() => {
      setNow(Date.now())
      refresh().catch(() => {})
    }, 1000)
    return () => clearInterval(poll)
  }, [refresh])

  const run = async (call: () => Promise<RemoteLinkStatus>) => {
    setBusy(true)
    try {
      setStatus(await call())
    } finally {
      setBusy(false)
    }
  }

  if (!status) {
    return <p className="text-sm text-gray-500">Checking the remote link…</p>
  }

  const pairingSecondsLeft = status.pairing
    ? Math.max(0, Math.round((status.pairing.expiresAt - now) / 1000))
    : 0

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-gray-300">Devices</h3>
        <p className="mt-1 text-xs leading-relaxed text-gray-500">
          Pair a phone or tablet and it talks to IRC through this desktop — one login, shared
          history, and no ports to open. Your IRC passwords stay here; paired devices never receive
          them.
        </p>
      </div>

      {/* Link status */}
      <div className="flex items-center justify-between rounded border border-gray-700 bg-gray-900/50 px-3 py-2.5">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm text-gray-200">
            <span
              className={`h-2 w-2 shrink-0 rounded-full ${
                status.running ? 'bg-green-500' : 'bg-gray-600'
              }`}
            />
            {status.running ? 'Link is on' : 'Link is off'}
          </div>
          <div className="mt-1 truncate font-mono text-[11px] text-gray-500">
            {status.error
              ? status.error
              : status.endpointId
                ? `this desktop: ${status.endpointId.slice(0, 24)}…`
                : 'Turn this on to let a device pair with this desktop.'}
          </div>
        </div>
        <button
          onClick={() =>
            run(() =>
              window.switchboard.invoke(status.running ? 'remote:stop' : 'remote:start')
            )
          }
          disabled={busy}
          className="ml-3 shrink-0 rounded bg-gray-700 px-3 py-1.5 text-xs font-medium text-gray-100 transition-colors hover:bg-gray-600 disabled:opacity-50"
        >
          {status.running ? 'Turn off' : 'Turn on'}
        </button>
      </div>

      {/* Who is on the network */}
      {session && (
        <div className="rounded border border-gray-700 bg-gray-900/50 px-3 py-2.5">
          <div className="flex items-center gap-2 text-sm text-gray-200">
            <span
              className={`h-2 w-2 shrink-0 rounded-full ${
                session.role === 'primary' ? 'bg-green-500' : 'bg-indigo-500'
              }`}
            />
            {session.role === 'primary'
              ? 'This desktop is holding the IRC connections'
              : 'Another device is holding the IRC connections'}
          </div>
          <div className="mt-1 text-xs leading-relaxed text-gray-500">
            {session.claiming
              ? 'Asking the other device to hand them back…'
              : session.role === 'primary'
                ? vault?.exists
                  ? 'Paired devices talk to IRC through this one. If it goes offline, they take over.'
                  : 'Paired devices talk to IRC through this one. Without a shared config below, they cannot take over when it goes offline.'
                : 'This desktop is following. It will take the connections back automatically.'}
          </div>
        </div>
      )}

      {/* Shared config */}
      <VaultPanel vault={vault} pairedDevices={status.devices.length} onChanged={refresh} />

      {/* Pairing */}
      {status.pairing && status.ticket ? (
        <div className="rounded border border-indigo-500/40 bg-gray-900/50 p-4">
          <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start">
            <TicketQR ticket={status.ticket} code={status.pairing.code} />
            <div className="min-w-0 flex-1 text-center sm:text-left">
              <div className="text-sm text-gray-200">Scan this in Switchboard on your phone</div>
              <div className="mt-0.5 text-xs text-gray-500">
                The code below is in the QR too — scanning is all it takes.
              </div>
              <div className="mt-2 font-mono text-2xl tracking-[0.3em] text-gray-100">
                {status.pairing.code}
              </div>
              <div className="mt-1 text-xs text-gray-500">
                Enter this code to confirm. Expires in {pairingSecondsLeft}s.
              </div>
              <button
                onClick={() => run(() => window.switchboard.invoke('remote:cancel-pairing'))}
                className="mt-3 text-xs text-gray-400 hover:text-gray-200"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : (
        <button
          onClick={() => run(() => window.switchboard.invoke('remote:start-pairing'))}
          disabled={busy}
          className="rounded bg-indigo-500 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-600 disabled:opacity-50"
        >
          Pair a device
        </button>
      )}

      {/* Paired devices */}
      <div>
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
          Paired devices
        </div>
        {status.devices.length === 0 ? (
          <p className="text-sm text-gray-500">No devices yet.</p>
        ) : (
          <div className="space-y-2">
            {status.devices.map((device) => {
              const online = status.connected.includes(device.endpointId)
              return (
                <div
                  key={device.endpointId}
                  className="flex items-center justify-between rounded border border-gray-700 bg-gray-900/50 px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm text-gray-200">
                      <span
                        className={`h-2 w-2 shrink-0 rounded-full ${
                          online ? 'bg-green-500' : 'bg-gray-600'
                        }`}
                      />
                      <span className="truncate">{device.name}</span>
                    </div>
                    <div className="mt-0.5 font-mono text-[11px] text-gray-500">
                      {online ? 'connected now' : lastSeen(device.lastSeenAt)} ·{' '}
                      {device.endpointId.slice(0, 12)}…
                    </div>
                  </div>
                  <button
                    onClick={() =>
                      run(() => window.switchboard.invoke('remote:revoke', device.endpointId))
                    }
                    className="ml-3 shrink-0 text-xs text-gray-400 transition-colors hover:text-red-400"
                    title="This device will have to pair again"
                  >
                    Revoke
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function lastSeen(iso: string | null): string {
  if (!iso) return 'never connected'
  const when = new Date(iso.replace(' ', 'T') + 'Z')
  if (Number.isNaN(when.getTime())) return 'last seen recently'
  return `last seen ${when.toLocaleString()}`
}

/**
 * The QR the phone scans.
 *
 * It carries the code as well as the ticket, so scanning is the whole of
 * pairing. That is safe in a way that showing the code alone is not: a QR is
 * read off the screen in front of you, and the window only accepts it for five
 * minutes.
 */
function TicketQR({ ticket, code }: { ticket: string; code: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    QRCode.toCanvas(canvas, encodePairingUri(ticket, code), {
      width: 160,
      margin: 1,
      color: { dark: '#0b0b12', light: '#ffffff' }
    }).catch(() => setFailed(true))
  }, [ticket, code])

  if (failed) {
    return (
      <div className="w-40 break-all rounded bg-gray-950 p-2 font-mono text-[9px] text-gray-400">
        {ticket}
      </div>
    )
  }

  return <canvas ref={canvasRef} className="shrink-0 rounded bg-white p-1" aria-label="Pairing QR code" />
}

/**
 * The shared vault.
 *
 * One passphrase, entered on each device, unlocks the same config: server list,
 * nicks, SASL credentials. It is what lets a phone take over a connection this
 * desktop was holding, and it is why that config is safe to send over any link.
 */
function VaultPanel({
  vault,
  pairedDevices,
  onChanged
}: {
  vault: VaultStatusInfo | null
  pairedDevices: number
  onChanged: () => Promise<void>
}) {
  const [passphrase, setPassphrase] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (!vault) return null

  const submit = async (): Promise<void> => {
    setError(null)

    if (!vault.exists && passphrase !== confirmation) {
      setError('The two passphrases do not match')
      return
    }
    if (passphrase.length < 8) {
      setError('Use at least 8 characters — this protects your account passwords')
      return
    }

    setBusy(true)
    try {
      await window.switchboard.invoke(vault.exists ? 'vault:unlock' : 'vault:create', passphrase)
      setPassphrase('')
      setConfirmation('')
      await onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not work')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded border border-gray-700 bg-gray-900/50 px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm text-gray-200">
          <span
            // Grey is for "not set up yet, and nothing is waiting on it".
            // Once a device is paired, its absence is worth a warning.
            className={`h-2 w-2 shrink-0 rounded-full ${
              vault.unlocked
                ? 'bg-green-500'
                : vault.exists || pairedDevices > 0
                  ? 'bg-yellow-500'
                  : 'bg-gray-600'
            }`}
          />
          Shared config
        </div>
        {vault.unlocked && (
          <button
            onClick={async () => {
              await window.switchboard.invoke('vault:lock')
              await onChanged()
            }}
            className="text-xs text-gray-400 hover:text-gray-200"
          >
            Lock
          </button>
        )}
      </div>

      <div className="mt-1 text-xs leading-relaxed text-gray-500">
        {vault.unlocked ? (
          <>
            Unlocked · v{vault.version} · fingerprint{' '}
            <span className="font-mono text-gray-400">{vault.fingerprint}</span>
            <div className="mt-0.5">
              Your servers and passwords sync to paired devices, sealed with this passphrase.
              Check the fingerprint matches on the other device.
            </div>
          </>
        ) : vault.exists ? (
          'Locked. Enter the passphrase to sync config with your other devices.'
        ) : pairedDevices > 0 ? (
          // A device is already paired and cannot stand in for this one. Say
          // that, rather than describing the feature and leaving them to
          // discover the gap the night the desktop goes down.
          <>
            <span className="text-yellow-500">
              {pairedDevices === 1 ? 'Your paired device' : 'Your paired devices'} can mirror
              this desktop but cannot take over when it goes offline.
            </span>{' '}
            Set a passphrase to share your server list and logins. It never leaves this
            device — only the sealed config does.
          </>
        ) : (
          'Set a passphrase to share your server list and passwords with your phone. It never leaves this device — only the sealed config does.'
        )}
      </div>

      {!vault.unlocked && (
        <div className="mt-2 space-y-2">
          <input
            type="password"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submit()
            }}
            placeholder={vault.exists ? 'Passphrase' : 'New passphrase'}
            className="w-full rounded bg-gray-800 px-2.5 py-1.5 text-sm text-gray-100 outline-none ring-1 ring-gray-700 focus:ring-indigo-500"
          />
          {!vault.exists && (
            <input
              type="password"
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submit()
              }}
              placeholder="Confirm passphrase"
              className="w-full rounded bg-gray-800 px-2.5 py-1.5 text-sm text-gray-100 outline-none ring-1 ring-gray-700 focus:ring-indigo-500"
            />
          )}
          {error && <div className="text-xs text-red-400">{error}</div>}
          <button
            onClick={() => void submit()}
            disabled={busy || passphrase.length === 0}
            className="rounded bg-gray-700 px-3 py-1.5 text-xs font-medium text-gray-100 transition-colors hover:bg-gray-600 disabled:opacity-50"
          >
            {vault.exists ? 'Unlock' : 'Create shared config'}
          </button>
        </div>
      )}
    </div>
  )
}
