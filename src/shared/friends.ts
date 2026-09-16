/**
 * "Tell me when this person turns up", in whichever dialect the network speaks.
 *
 * Two commands do the same job. MONITOR is the one IRCv3 specified and the one
 * both clients were written against; WATCH is what the older families —
 * bahamut, plexus, UnrealIRCd, and everything descended from them — have had
 * since long before. A network offers one, the other, or both, and says so in
 * ISUPPORT.
 *
 * Switchboard only ever sent MONITOR, so on DALnet and Rizon the friend list
 * was a screen you could add names to that would never once tell you anything.
 * The phone checked ISUPPORT and quietly did nothing; the desktop sent the
 * command anyway and collected an "unknown command" no one saw.
 *
 * The replies differ but mean the same things, so both sides map onto the same
 * two events and nothing above this has to know which was used.
 */

import { advertises } from './isupport'

export type FriendListKind = 'MONITOR' | 'WATCH'

type Isupport = Record<string, string | true | null | undefined>

/**
 * Which command this network takes, preferring MONITOR.
 *
 * MONITOR reports arrivals and departures with no polling and takes a
 * comma-separated list; WATCH does the same thing a nick at a time with a `+`
 * on each. Where a server offers both — UnrealIRCd does — MONITOR is the
 * better-specified of the two.
 */
export function friendListKind(isupport: Isupport): FriendListKind | null {
  if (advertises(isupport, 'MONITOR')) return 'MONITOR'
  if (advertises(isupport, 'WATCH')) return 'WATCH'
  return null
}

/** How many names the network will hold for us, if it said */
export function friendListLimit(isupport: Isupport): number | null {
  const kind = friendListKind(isupport)
  if (!kind) return null
  const value = isupport[kind]
  if (typeof value !== 'string') return null
  const limit = parseInt(value, 10)
  return Number.isFinite(limit) && limit > 0 ? limit : null
}

/**
 * Anything longer than this and the line stops being one line.
 *
 * A message is 512 bytes including the command, the trailing CRLF and, on the
 * way back, a source prefix the server prepends. Keeping the target list well
 * inside that leaves room for all of it. A hundred friends at ten characters
 * each was over the limit in one line, and the ones past the cut were simply
 * never watched — no error, because the server never saw them.
 */
const PARAMS_BUDGET = 400

/**
 * The lines that add or drop these nicks.
 *
 * Always a list, because a friend list long enough to be useful is long enough
 * to need more than one line.
 */
export function friendListLines(
  kind: FriendListKind,
  nicks: string[],
  action: 'add' | 'remove'
): string[] {
  const wanted = nicks.filter((nick) => nick.length > 0)
  if (wanted.length === 0) return []

  const sign = action === 'add' ? '+' : '-'
  const lines: string[] = []
  let batch: string[] = []

  const flush = (): void => {
    if (batch.length === 0) return
    lines.push(
      kind === 'MONITOR'
        ? `MONITOR ${sign} ${batch.join(',')}`
        : `WATCH ${batch.map((nick) => sign + nick).join(' ')}`
    )
    batch = []
  }

  for (const nick of wanted) {
    // MONITOR separates with a comma, WATCH repeats the sign on each name
    const cost = kind === 'MONITOR' ? nick.length + 1 : nick.length + 2
    const spent = batch.reduce(
      (total, held) => total + (kind === 'MONITOR' ? held.length + 1 : held.length + 2),
      0
    )
    if (batch.length > 0 && spent + cost > PARAMS_BUDGET) flush()
    batch.push(nick)
  }
  flush()

  return lines
}

/**
 * Ask the network who on the list is here right now.
 *
 * MONITOR S answers with 730/731. WATCH's equivalent is `L`, which reports
 * every entry as online or offline — `WATCH S` is the other question.
 */
export function friendListStatusLine(kind: FriendListKind): string {
  return kind === 'MONITOR' ? 'MONITOR S' : 'WATCH L'
}

/**
 * Ask the network what is on the list at all.
 *
 * The two commands swap letters here, which is exactly the sort of thing that
 * makes a fallback look like it works until you read the replies: MONITOR L
 * answers with 732, and the WATCH command that answers with 606 is `S`.
 */
export function friendListListLine(kind: FriendListKind): string {
  return kind === 'MONITOR' ? 'MONITOR L' : 'WATCH S'
}

/**
 * One friend, on the one network they are a friend on.
 *
 * A nick means nothing without a network — `rowan` on one is not `rowan` on
 * another, and on IRC that is not a technicality: the name is first come first
 * served on each network separately. So the pair travels together and is
 * written the way people write it.
 */
export interface Watched {
  serverId: string
  /** What the network is called here, for reading */
  network: string
  nick: string
  online: boolean
}

export interface Friend extends Watched {
  /** `nick@network`, which is the whole of who somebody is */
  label: string
}

export function friendLabel(nick: string, network: string): string {
  return network ? `${nick}@${network}` : nick
}

/**
 * Every watched nick on every network, as one list.
 *
 * Friends used to be a section under whichever network you were looking at, so
 * finding out whether anybody was about meant clicking through the networks one
 * at a time — and a person you watch on a network you have not opened today was
 * simply not on screen. Direct messages had already stopped being per-network
 * for the same reason.
 *
 * Online first, because the list is read to answer "is anyone around?", and
 * that question is answered by the top of it. Then by name, then by network, so
 * two people with the same nick on two networks sit together and are still two
 * rows — never merged, since there is no reason to think they are one person.
 */
export function friendRoster(watched: readonly Watched[]): Friend[] {
  return watched
    .map((one) => ({ ...one, label: friendLabel(one.nick, one.network) }))
    .sort((a, b) => {
      const around = Number(b.online) - Number(a.online)
      if (around !== 0) return around

      const byNick = a.nick.toLowerCase().localeCompare(b.nick.toLowerCase())
      if (byNick !== 0) return byNick

      return a.network.toLowerCase().localeCompare(b.network.toLowerCase())
    })
}
