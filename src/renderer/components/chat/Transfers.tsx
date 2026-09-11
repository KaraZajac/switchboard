import { useState, useEffect } from 'react'
import type { DccTransfer } from '@shared/dcc'

/**
 * Files somebody is sending you, or you are sending them.
 *
 * A strip above the composer rather than a panel of its own: an offer is
 * something happening right now in this conversation, and a transfer nobody
 * notices is one nobody accepts.
 *
 * Nothing starts on its own. An offer sits here until somebody presses a
 * button, which is the whole reason DCC has the reputation it does.
 */
export function Transfers({ serverId, peer }: { serverId: string; peer: string }) {
  const [transfers, setTransfers] = useState<DccTransfer[]>([])

  useEffect(() => {
    void window.switchboard.invoke('dcc:list').then(setTransfers)

    const off = window.switchboard.on('dcc:transfer', (data) => {
      const changed = data as DccTransfer
      setTransfers((all) => {
        const rest = all.filter((one) => one.id !== changed.id)
        // A refusal is not a row; it is the absence of one.
        return changed.state === 'declined' ? rest : [...rest, changed]
      })
    })
    // `/dcc send` typed in the composer. The picker belongs to the window, so
    // the command asks and this answers.
    const offWanted = window.switchboard.on('dcc:offer-wanted', (data) => {
      const wanted = data as { serverId: string; nick: string }
      void window.switchboard.invoke('dcc:offer', wanted.serverId, wanted.nick)
    })

    return () => {
      off()
      offWanted()
    }
  }, [])

  const mine = transfers.filter(
    (one) =>
      one.serverId === serverId &&
      one.peer.toLowerCase() === peer.toLowerCase() &&
      one.state !== 'declined'
  )

  if (mine.length === 0) return null

  return (
    <div className="space-y-1 border-t border-gray-800 px-3 py-2">
      {mine.map((transfer) => (
        <div key={transfer.id} className="flex items-center gap-2 text-xs">
          <span className="shrink-0 text-gray-500">
            {transfer.direction === 'incoming' ? '↓' : '↑'}
          </span>

          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <span className="truncate text-gray-200">{transfer.filename}</span>
              <span className="shrink-0 text-gray-500">{sizeOf(transfer.size)}</span>
            </div>

            {transfer.state === 'active' && (
              <div className="mt-1 h-1 overflow-hidden rounded bg-gray-800">
                <div
                  className="h-full bg-indigo-500 transition-[width]"
                  style={{
                    width: transfer.size > 0
                      ? `${Math.min(100, (transfer.transferred / transfer.size) * 100)}%`
                      : '100%'
                  }}
                />
              </div>
            )}

            {transfer.state === 'failed' && (
              <div className="text-red-400">{transfer.error ?? 'It did not work'}</div>
            )}
            {transfer.state === 'done' && (
              <div className="truncate text-green-400">
                {transfer.direction === 'incoming' ? `Saved to ${transfer.path}` : 'Sent'}
              </div>
            )}
          </div>

          {/*
            An incoming offer, and nothing has happened yet. The person who
            sent it does not get to decide that this machine connects to
            theirs.
          */}
          {transfer.state === 'offered' && transfer.direction === 'incoming' && (
            <div className="flex shrink-0 gap-1">
              <button
                onClick={() => void window.switchboard.invoke('dcc:accept', transfer.id)}
                className="rounded bg-indigo-500 px-2 py-0.5 text-white hover:bg-indigo-600"
              >
                Accept
              </button>
              <button
                onClick={() => void window.switchboard.invoke('dcc:decline', transfer.id)}
                className="rounded px-2 py-0.5 text-gray-400 hover:bg-gray-700 hover:text-gray-200"
              >
                Decline
              </button>
            </div>
          )}

          {transfer.state === 'offered' && transfer.direction === 'outgoing' && (
            <span className="shrink-0 text-gray-500">Waiting for them…</span>
          )}
        </div>
      ))}
    </div>
  )
}

/** Bytes, in the units a person reads */
function sizeOf(bytes: number): string {
  if (bytes <= 0) return 'unknown size'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value < 10 && unit > 0 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`
}
