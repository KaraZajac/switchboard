import type { IRCManager } from '../irc/manager'
import { getSetting } from '../storage/models/settings'
import { awayAction, awayMessage } from '@shared/autoaway'

/**
 * Away when nobody is reading.
 *
 * A bouncer stays on the network whether or not anybody is looking at it,
 * which is the point and also the problem: to everybody else you are present
 * and simply not answering. Every bouncer since znc has solved it the same
 * way — away while nothing is attached, back the moment something is.
 *
 * "Attached" means anything that can actually show somebody the messages: an
 * IRC client on the port, or a paired phone or desktop on the remote link.
 * Counting only the first would mark you away while you read on your phone.
 *
 * The decision itself is `@shared/autoaway`, the same rule the desktop uses
 * for a quiet keyboard and the phone for a dark screen. What differs is only
 * what counts as nobody being there.
 */

/** How often to look. The same half minute the desktop's idle watch uses. */
const TICK_MS = 30_000

/** Minutes with nothing attached before going away */
const AFTER_MINUTES = 'bouncerAwayMinutes'

/** What to say. Empty means the ordinary default. */
const AWAY_MESSAGE = 'bouncerAwayMessage'

/** A default worth having, because the feature is useless switched off */
const DEFAULT_AFTER_MINUTES = 5

let timer: ReturnType<typeof setInterval> | null = null

/** Networks we put into away ourselves, so we only take back what we set */
const setByUs = new Set<string>()

/** When the last client or device let go. Null while something is attached. */
let aloneSince: number | null = Date.now()

export interface Watchers {
  /** How many IRC clients are on the port */
  attached: () => number
  /** How many paired devices are on the remote link */
  linked: () => number
}

export function watchWhoIsReading(manager: IRCManager, watchers: Watchers): void {
  stopWatchingWhoIsReading()
  timer = setInterval(() => tick(manager, watchers), TICK_MS)
  // Look once immediately: waiting half a minute to notice that a machine
  // which has just started has nobody on it is half a minute of claiming to be
  // present.
  tick(manager, watchers)
}

export function stopWatchingWhoIsReading(): void {
  if (timer) clearInterval(timer)
  timer = null
  setByUs.clear()
  aloneSince = Date.now()
}

function tick(manager: IRCManager, watchers: Watchers): void {
  const reading = watchers.attached() + watchers.linked()

  if (reading > 0) {
    aloneSince = null
  } else if (aloneSince === null) {
    aloneSince = Date.now()
  }

  const afterMinutes = Number(getSetting<number>(AFTER_MINUTES) ?? DEFAULT_AFTER_MINUTES)
  const alone = aloneSince === null ? 0 : (Date.now() - aloneSince) / 1000

  for (const [serverId, client] of manager.connections()) {
    if (client.state.registrationState !== 'connected') continue

    const action = awayAction({
      idleSeconds: alone,
      afterMinutes,
      alreadyAway: client.state.away,
      // Never over the top of an away somebody set themselves — clearing that
      // because a client attached tells the channel they are back from a lunch
      // they are still at
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
