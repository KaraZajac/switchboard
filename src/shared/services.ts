/**
 * Recognising the services bots, and what they are asking for.
 *
 * Most of IRC has no `draft/account-registration`. It has a bot called NickServ
 * that sends you a notice in English and waits, and for a great many people
 * that notice is the first thing that happens after they connect — often the
 * only thing, because a client that shows it as an ordinary message from an
 * ordinary stranger gives them no reason to act on it.
 *
 * So the phrases are matched. Not to parse them: only to know that *this* is
 * the moment to offer the login screen, which is the difference between a
 * client that helps and one that watches.
 *
 * The Kotlin half is `Services.kt`, and both are checked against
 * `tests/fixtures/services.json`.
 */

import { isServiceNick } from './constants'

/**
 * Whether this notice is asking us to log in.
 *
 * The wording differs by network — Atheme, Anope and rIRCd each have their own —
 * so this matches on what they have in common rather than on any one of them.
 * Being wrong in the permissive direction costs a banner nobody needed; being
 * wrong the other way costs the whole point of noticing.
 */
export function asksForIdentification(text: string): boolean {
  const line = text.toLowerCase()

  const aboutThisNick =
    line.includes('nickname is registered') ||
    line.includes('nick is registered') ||
    line.includes('this nickname is owned') ||
    line.includes('is a registered nick')

  const tellsYouHow = line.includes('identify') || line.includes('/msg nickserv')

  return aboutThisNick || (tellsYouHow && line.includes('password'))
}

/**
 * Whether it says we succeeded.
 *
 * Worth knowing separately: a client that offers "log in" to somebody who just
 * logged in is not paying attention, and on a network with no `account-notify`
 * this notice is the only signal there is.
 */
export function confirmsIdentification(text: string): boolean {
  const line = text.toLowerCase()
  return (
    line.includes('you are now identified') ||
    line.includes('you are now logged in') ||
    line.includes('password accepted') ||
    line.includes('now recognized')
  )
}

/**
 * The services commands whose arguments are a password, or a proof of one.
 *
 * `IDENTIFY`, `REGISTER`, `GHOST` and the rest take the password on the line,
 * and the line is a message like any other: echoed back by the server, filed
 * under the NickServ conversation, written to the history database. A
 * password kept in plain text in the message history is a password on disk
 * in a file that is not the one meant to hold it. `SET PASSWORD` keeps its
 * second word, which names the setting rather than the secret.
 */
const SECRET_COMMANDS = new Set([
  'identify',
  'id',
  'register',
  'ghost',
  'recover',
  'release',
  'regain',
  'drop',
  'verify',
  'confirm',
  'login',
  'auth',
  'sidentify',
  'group',
  'set'
])

const MASK = '•••'

/**
 * What a line said to services is kept and shown as.
 *
 * Only to a services bot, only for the commands that carry a secret, and only
 * when there is anything after the verb to hide. Everything else — a message to
 * a person that happens to say "identify", `NickServ INFO kara` — is left as
 * it was. The Kotlin half is `Services.secretsMasked`, and both are checked
 * against `tests/fixtures/services.json`.
 */
export function secretsMasked(target: string, text: string): string {
  if (!isServiceNick(target)) return text
  const trimmed = text.trim()
  const words = trimmed.split(/\s+/)
  if (words.length < 2) return text
  const verb = words[0].toLowerCase()
  if (!SECRET_COMMANDS.has(verb)) return text
  // `SET PASSWORD x`: the setting's name is not the secret; any other SET is
  // not a secret at all
  if (verb === 'set') {
    if (words[1].toLowerCase() !== 'password' || words.length < 3) return text
    return `${words[0]} ${words[1]} ${MASK}`
  }
  return `${words[0]} ${MASK}`
}
