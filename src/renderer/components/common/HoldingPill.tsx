import { useEffect, useState } from 'react'
import { holdingLabel, holdingDetail, type Holder } from '@shared/holding'

/**
 * Which thing is holding the connections, in one word.
 *
 * The phone has had this in its header for a while and the desktop had it
 * nowhere but a settings screen — so somebody whose desktop had quietly handed
 * over to an always-on instance had no way to see that from the window they
 * were looking at.
 *
 * In the title bar rather than beside the nick, because the panel that holds
 * the nick is hidden whenever the network you are looking at is disconnected —
 * which is exactly the state a following desktop is in, and exactly when the
 * word is worth reading.
 *
 * The word is decided in the main process, where the facts are, by the rule the
 * phone follows too. This asks rather than works it out, so the two cannot
 * drift apart.
 */
export function HoldingPill() {
  const [holder, setHolder] = useState<Holder | null>(null)

  useEffect(() => {
    let alive = true
    const ask = (): void => {
      window.switchboard
        .invoke('session:holding')
        .then((state) => {
          if (alive) setHolder(state.holder)
        })
        .catch(() => {})
    }

    ask()
    /*
     * Pushed rather than polled: it changes rarely and matters immediately.
     * The connection events are here too, because holding nothing and holding
     * something are different words for the same session role.
     */
    const offSession = window.switchboard.on('session:changed', ask)
    const offUp = window.switchboard.on('irc:connected', ask)
    const offDown = window.switchboard.on('irc:disconnected', ask)

    return () => {
      alive = false
      offSession()
      offUp()
      offDown()
    }
  }, [])

  // Nothing at all rather than OFFLINE: the rail already shows every network
  // as disconnected, and a second word for it is noise on the ordinary path
  // through a restart.
  if (!holder || holder === 'offline') return null

  const tone =
    holder === 'live' || holder === 'bouncer'
      ? 'bg-green-500/15 text-green-400'
      : holder === 'desktop'
        ? 'bg-indigo-500/15 text-indigo-300'
        : 'bg-yellow-500/15 text-yellow-400'

  return (
    <span
      className={`mx-2 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide ${tone}`}
      title={holdingDetail(holder)}
    >
      {holdingLabel(holder)}
    </span>
  )
}
