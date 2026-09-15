import type { RawLine } from '@shared/types/ipc'

/**
 * The wire, kept for as long as it is useful and no longer.
 *
 * Every mainstream client has one of these, and debugging a network without
 * it means guessing. The lines were already being emitted and nothing was
 * listening, so opening a log showed only what happened after you opened it —
 * which is never the interesting part. Kept here instead, so the log opens on
 * the connection that has already gone wrong.
 *
 * Bounded per network. A busy server is thousands of lines an hour and this
 * is a debugging aid, not a second history.
 */

/** Lines kept per network */
export const RAW_LOG_LIMIT = 1000

const logs = new Map<string, RawLine[]>()

/**
 * Anything that would be a credential in the clear.
 *
 * `PASS`, the server password. `AUTHENTICATE`, which for SASL PLAIN is base64
 * of `user\0user\0password` and decodes in one step. `OPER`, and the services
 * commands people type by hand.
 *
 * Masked here rather than in the view, so a log that is copied, saved or
 * pasted into a bug report has never held the secret at all. The command is
 * left readable: which line it was matters, what was in it does not.
 */
const SECRET_FIRST_WORD = new Set(['pass', 'authenticate', 'oper'])

/** `PRIVMSG NickServ :IDENTIFY hunter2` and the rest of the by-hand logins */
const SECRET_TO_SERVICES = /^(privmsg\s+(?:nickserv|chanserv|nickserv@\S+)\s+:?)(identify|register|ghost|regain|release|recover|set\s+password)\s+(.+)$/i

export function maskSecrets(line: string): string {
  const trimmed = line.trimStart()
  const first = trimmed.split(/\s+/, 1)[0]?.toLowerCase() ?? ''

  if (SECRET_FIRST_WORD.has(first)) {
    // Keep the command, drop everything after it
    return `${trimmed.slice(0, first.length)} ***`
  }

  const services = trimmed.match(SECRET_TO_SERVICES)
  if (services) return `${services[1]}${services[2]} ***`

  return line
}

export function rememberRaw(serverId: string, direction: 'in' | 'out', line: string): RawLine {
  const entry: RawLine = {
    at: new Date().toISOString(),
    direction,
    line: maskSecrets(line)
  }

  const kept = logs.get(serverId)
  if (kept) {
    kept.push(entry)
    if (kept.length > RAW_LOG_LIMIT) kept.splice(0, kept.length - RAW_LOG_LIMIT)
  } else {
    logs.set(serverId, [entry])
  }

  return entry
}

export function rawLogFor(serverId: string): RawLine[] {
  return [...(logs.get(serverId) ?? [])]
}

export function clearRawLog(serverId: string): void {
  logs.delete(serverId)
}
