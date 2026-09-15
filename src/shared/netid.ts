import { foldCase } from './casemap'

/**
 * Which network a server entry *is*, independent of the id it was given.
 *
 * Every device generates its own id when a network is added, so the same
 * server set up twice — once here, once on the phone — is two entries with
 * nothing in common but where they point. Adopting a shared config then read
 * as "five networks I have never seen", and on the desktop removing a server
 * cascades: the history of a network you already had went with it.
 *
 * Host and port alone are not enough. Two accounts on one server is ordinary
 * — `netslum` and `netslum2` on the same address — and merging those would
 * throw one of them away. The nick is what separates them, folded the way the
 * IRC casemap folds it, because `Kara` and `kara` are one person.
 */
export function networkKey(server: { host: string; port: number; nick: string }): string {
  return `${server.host.trim().toLowerCase()}:${server.port}/${foldCase(server.nick.trim())}`
}

/** Whether two entries are the same network under different ids */
export function sameNetwork(
  a: { host: string; port: number; nick: string },
  b: { host: string; port: number; nick: string }
): boolean {
  return networkKey(a) === networkKey(b)
}

/**
 * Old id → new id, for a config about to be adopted.
 *
 * Only where the two disagree: an entry already under the right id is not a
 * move, and a network that is genuinely new has nothing to move.
 */
export function reidentified(
  mine: Array<{ id: string; host: string; port: number; nick: string }>,
  theirs: Array<{ id: string; host: string; port: number; nick: string }>
): Record<string, string> {
  const incoming = new Map(theirs.map((server) => [networkKey(server), server.id]))
  const known = new Set(theirs.map((server) => server.id))
  const moves: Record<string, string> = {}

  for (const server of mine) {
    // Already agreed on; nothing to do
    if (known.has(server.id)) continue

    const id = incoming.get(networkKey(server))
    if (id && id !== server.id) moves[server.id] = id
  }

  return moves
}
