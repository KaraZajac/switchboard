import { useMemo, useState } from 'react'
import { suggestedNetworks, NETWORKS_CHECKED_AT, type KnownNetwork } from '@shared/networks'

/**
 * Somewhere to start, for somebody with no networks.
 *
 * IRC's worst moment is the first one. A client that opens on an empty screen
 * and a box wanting a hostname is asking a question most people cannot answer,
 * and nothing in the app helps them answer it — you are expected to already
 * know that irc.libera.chat exists, and which of the dozen networks is the one
 * your people are on.
 *
 * So: the twelve that most people mean, with what each is for. Typing a
 * hostname by hand is still one click away, because a list is a starting point
 * and not a directory.
 */
export function NetworkPicker({
  onPick,
  onByHand
}: {
  onPick: (network: KnownNetwork) => void
  onByHand: () => void
}) {
  const [query, setQuery] = useState('')
  const shown = useMemo(() => suggestedNetworks(query), [query])

  return (
    <div className="space-y-3">
      <input
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search by name, subject or where it is"
        className="w-full rounded bg-gray-900 px-3 py-2 text-sm text-gray-100 ring-1 ring-gray-700 focus:outline-none focus:ring-indigo-500"
      />

      <div className="max-h-[22rem] space-y-1 overflow-y-auto pr-1">
        {shown.map((network) => (
          <button
            key={network.id}
            onClick={() => onPick(network)}
            title={network.checked}
            className="w-full rounded px-3 py-2.5 text-left hover:bg-gray-700/50"
          >
            <div className="flex items-baseline gap-2">
              <span className="font-semibold text-gray-100">{network.name}</span>
              <span className="text-xs text-gray-500">{network.region}</span>
            </div>
            <div className="mt-0.5 text-sm leading-snug text-gray-400">{network.description}</div>
            <div className="mt-1 font-mono text-xs text-gray-600">
              {network.host}:{network.port}
              {network.tls ? (
                ' · TLS'
              ) : (
                // Said out loud rather than left as an absence. A network with
                // no encrypted port is a real choice somebody is making, and
                // they can only make it if we tell them.
                <span className="ml-1 font-sans text-amber-500/80">not encrypted</span>
              )}
            </div>
          </button>
        ))}

        {shown.length === 0 && (
          <p className="px-3 py-6 text-center text-sm text-gray-500">
            Nothing here matches “{query}”. Plenty of networks are not on this
            list — put its address in by hand.
          </p>
        )}
      </div>

      <div className="flex items-center justify-between border-t border-gray-700 pt-3">
        <span className="text-xs text-gray-600">Checked {NETWORKS_CHECKED_AT}</span>
        <button onClick={onByHand} className="text-sm text-indigo-400 hover:text-indigo-300">
          I know the address — enter it myself
        </button>
      </div>
    </div>
  )
}
