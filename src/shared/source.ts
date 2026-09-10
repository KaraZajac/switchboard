/**
 * Whether a line came from a server or from a person.
 *
 * A private message is filed under whoever sent it, which is right until the
 * sender is not a who. Servers send notices constantly — the connection
 * banner, the hostname mask, "you are now logged in", the ones an oper sends
 * to every client — and Rizon sends them with the server's own name in front:
 *
 *     :irc.rizon.life NOTICE sbtest747 :*** Your host is masked
 *
 * Filed the ordinary way, that opens a conversation with a person called
 * `irc.rizon.life`, sitting in Direct Messages between two real ones, with an
 * unread badge and a notification. Both clients already had somewhere better
 * to put it — the server console — and both already routed the one case where
 * the source is a bare `*`, which is what solanum uses before registration.
 * This is the same question asked properly.
 *
 * The test is what the prefix is shaped like. A person arrives as
 * `nick!user@host`; a server has nothing but a name, and a nick cannot contain
 * a dot on any ircd — RFC 2812 does not allow it, and no network has since
 * added it. Services are people by this rule, which is right: NickServ is
 * someone you hold a conversation with.
 */
export function isServerSource(prefix: string | null | undefined): boolean {
  if (!prefix) return true
  // Before registration a server has not been told its own name yet
  if (prefix === '*') return true
  // nick!user@host, or nick@host on the few that leave the user out
  if (prefix.includes('!') || prefix.includes('@')) return false
  return prefix.includes('.')
}
