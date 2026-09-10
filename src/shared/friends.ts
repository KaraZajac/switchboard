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
  if (isupport['MONITOR'] !== undefined && isupport['MONITOR'] !== null) return 'MONITOR'
  if (isupport['WATCH'] !== undefined && isupport['WATCH'] !== null) return 'WATCH'
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
