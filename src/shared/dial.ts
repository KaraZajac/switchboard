/**
 * Whether a change to a network means dialling it again.
 *
 * Editing a server writes the new settings down. Both clients then left the
 * running connection exactly as it was — so changing the address and pressing
 * save left you connected to the old one, with the list showing the new
 * address and a green dot beside it. Nothing was wrong on screen; nothing had
 * changed on the wire.
 *
 * Not every edit deserves that. Turning off "connect automatically", editing
 * the join list, setting a profile — none of those touch the socket, and
 * dropping someone out of a conversation to apply them would be worse than the
 * bug. These are the fields that decide where the connection goes and what it
 * is: change one and the connection is no longer the one described.
 *
 * A nick is deliberately not on the list. It can be changed on a live
 * connection with NICK, which is the better answer than reconnecting, and the
 * clients already do that.
 */

interface Dialled {
  host?: string
  port?: number
  tls?: boolean
  websocketUrl?: string | null
}

export function dialChanged(before: Dialled, after: Dialled): boolean {
  for (const field of ['host', 'port', 'tls', 'websocketUrl'] as const) {
    // An absent field in the update means "leave it alone", not "clear it"
    if (after[field] === undefined) continue
    if (before[field] !== after[field]) return true
  }
  return false
}
