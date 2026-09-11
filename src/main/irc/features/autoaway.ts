import { powerMonitor } from 'electron'
import type { IRCManager } from '../manager'
import { getSetting } from '../../storage/models/settings'
import { awayAction, awayMessage } from '@shared/autoaway'

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
 *
 * What to do with that number is in `src/shared/autoaway.ts`, because the phone
 * asks the same question of a clock of its own and the two have to answer it
 * the same way.
 */

/** The setting holding how many minutes of nothing counts as away */
const AFTER_MINUTES = 'autoAwayMinutes'

/** And what to say. Empty means the ordinary default. */
const AWAY_MESSAGE = 'autoAwayMessage'

/** How often to look. Once every half minute is often enough for a minute-grained rule. */
const TICK_MS = 30_000

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

function tick(manager: IRCManager): void {
  const afterMinutes = Number(getSetting<number>(AFTER_MINUTES) ?? 0)
  const idleSeconds = powerMonitor.getSystemIdleTime()

  for (const [serverId, client] of manager.connections()) {
    if (client.state.registrationState !== 'connected') continue

    const action = awayAction({
      idleSeconds,
      afterMinutes,
      alreadyAway: client.state.away,
      setByUs: setByUs.has(serverId)
    })

    if (action === 'set') {
      client.connection.send('AWAY', awayMessage(getSetting<string>(AWAY_MESSAGE)))
      setByUs.add(serverId)
    } else if (action === 'clear') {
      client.connection.send('AWAY')
      setByUs.delete(serverId)
    }
  }
}
