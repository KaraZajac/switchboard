import { powerMonitor } from 'electron'
import type { IRCManager } from '../manager'
import { getSetting } from '../../storage/models/settings'

/**
 * Go away when you stop typing, and come back when you start.
 *
 * Every other client has had this for decades, and without it your away
 * message is only ever what you last set by hand — which for most people is
 * nothing, so the network thinks you are at the keyboard at four in the
 * morning and messages go unanswered without anyone knowing why.
 *
 * The idle clock is the operating system's, not ours: Electron's
 * `powerMonitor.getSystemIdleTime` counts time since the last input *anywhere*,
 * which is the right question. A window-focus heuristic would call somebody
 * away for reading a different window, which is not what away means.
 */

/** The setting holding how many minutes of nothing counts as away */
const AFTER_MINUTES = 'autoAwayMinutes'

/** And what to say. Empty means the ordinary default. */
const AWAY_MESSAGE = 'autoAwayMessage'

/** How often to look. Once a minute is often enough for a minute-grained rule. */
const TICK_MS = 30_000

const DEFAULT_MESSAGE = 'Away from the keyboard'

let timer: ReturnType<typeof setInterval> | null = null

/** Networks we put into away ourselves, so we only take back what we set */
const setByUs = new Set<string>()

/**
 * Start watching the idle clock.
 *
 * Safe to call again; the previous watch is replaced rather than doubled.
 */
export function watchIdleTime(manager: IRCManager): void {
  stopWatchingIdleTime()
  timer = setInterval(() => tick(manager), TICK_MS)
}

export function stopWatchingIdleTime(): void {
  if (timer) clearInterval(timer)
  timer = null
  setByUs.clear()
}

/** One look at the clock. Exported for the test, which has no power monitor. */
export function decide(idleSeconds: number, afterMinutes: number): 'away' | 'back' | 'nothing' {
  // Zero, or anything that is not a number, means the feature is off — not
  // "go away immediately", which is what a missing setting read as a number
  // would otherwise produce.
  if (!Number.isFinite(afterMinutes) || afterMinutes <= 0) return 'back'
  return idleSeconds >= afterMinutes * 60 ? 'away' : 'back'
}

function tick(manager: IRCManager): void {
  const afterMinutes = Number(getSetting<number>(AFTER_MINUTES) ?? 0)
  const idle = powerMonitor.getSystemIdleTime()
  const wanted = decide(idle, afterMinutes)

  for (const [serverId, client] of manager.connections()) {
    if (client.state.registrationState !== 'connected') continue

    if (wanted === 'away') {
      // Never over the top of an away message somebody set themselves — that
      // one says something this one does not know.
      if (client.state.away || setByUs.has(serverId)) continue
      const message = String(getSetting<string>(AWAY_MESSAGE) || DEFAULT_MESSAGE)
      client.connection.send('AWAY', message)
      setByUs.add(serverId)
      continue
    }

    // Only take back what we set. Somebody who typed `/away lunch` and then
    // touched the mouse has not come back from lunch.
    if (!setByUs.has(serverId)) continue
    client.connection.send('AWAY')
    setByUs.delete(serverId)
  }
}
