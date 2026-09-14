/**
 * What an `irc://` link means.
 *
 * `irc://irc.example.org/#channel`, `ircs://host:6697/channel` and the rest
 * of the forms the draft standard and twenty years of web pages have used.
 * Every desktop client registers for these; a link on a project's page
 * opened nothing here. One parser for both clients — the Kotlin half is
 * `IrcUrl.kt`, checked against `tests/fixtures/ircurl.json`.
 */

export interface IrcLink {
  host: string
  port: number
  tls: boolean
  /** With its `#`, or null for a link to the server alone */
  channel: string | null
  /** A person, when the link said `,isnick` */
  nick: string | null
}

export function parseIrcUrl(raw: string): IrcLink | null {
  // A `#` here is a channel, not a fragment — the one place on the web it is not
  const match = /^(ircs?):\/\/([^/?#\s]+)(?:\/([^?\s]*))?(?:\?[^\s]*)?$/i.exec(raw.trim())
  if (!match) return null
  const tls = match[1].toLowerCase() === 'ircs'
  const authority = match[2].replace(/^[^@]*@/, '')
  const hostPort = /^(\[[^\]]+\]|[^:]+)(?::(\d+))?$/.exec(authority)
  if (!hostPort) return null
  const host = hostPort[1].replace(/^\[|\]$/g, '')
  const port = hostPort[2] ? Number(hostPort[2]) : tls ? 6697 : 6667
  if (!host || !Number.isInteger(port) || port <= 0 || port > 65535) return null

  let target = decodeURIComponent(match[3] ?? '').split(',')[0]
  const modifiers = (match[3] ?? '').split(',').slice(1).map((m) => m.toLowerCase())
  if (target === '') return { host, port, tls, channel: null, nick: null }
  if (modifiers.includes('isnick')) return { host, port, tls, channel: null, nick: target }
  if (!/^[#&!+]/.test(target)) target = '#' + target
  return { host, port, tls, channel: target, nick: null }
}
