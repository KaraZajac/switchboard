import type { IRCClient } from './client'
import { isupportNumber, fitsLimit } from '@shared/isupport'
import { parsePrefix, quietMode, banMask } from '@shared/powers'
import { maskToSet } from '@shared/masklists'

/**
 * Slash commands typed into the composer.
 *
 * Anything starting with a single "/" is a command. Unrecognised ones are
 * reported back to the user rather than sent to the channel — typing
 * "/msg NickServ IDENTIFY hunter2" must never end up as a public message.
 * A doubled slash ("//hello") escapes, and sends a literal "/hello".
 */

export interface CommandResult {
  /** False when the text is an ordinary message and should be sent as one */
  handled: boolean
  /** Text to send as a message instead (used by the // escape) */
  message?: string
  /** Set when the command could not be run */
  error?: string
}

const CHANNEL_PREFIXES = '#&+!'

const isChannel = (name: string): boolean => !!name && CHANNEL_PREFIXES.includes(name[0])

/**
 * Refuse text the server would silently cut, and say by how much.
 *
 * `TOPICLEN`, `AWAYLEN` and `KICKLEN` are not refusals — go over one and the
 * server accepts the command and quietly keeps the first N bytes. The user
 * finds out later, if at all. Better to say so now and let them decide what to
 * cut, since they are the only one who knows which half mattered.
 */
function tooLongFor(
  client: { state: { isupport: Record<string, string | true> } },
  token: string,
  /** The whole noun phrase, article and all — "an away message", not "away message" */
  what: string,
  text: string
): string | null {
  const limit = isupportNumber(client.state.isupport, token)
  if (fitsLimit(text, limit)) return null

  const length = Buffer.byteLength(text, 'utf8')
  return `This network allows ${limit} characters in ${what} and yours is ${length}.`
}

export function runCommand(client: IRCClient, target: string, text: string): CommandResult {
  if (!text.startsWith('/')) return { handled: false }

  // "//text" sends a literal message beginning with a slash
  if (text.startsWith('//')) return { handled: false, message: text.slice(1) }

  const spaceIdx = text.indexOf(' ')
  const name = (spaceIdx === -1 ? text.slice(1) : text.slice(1, spaceIdx)).toLowerCase()
  const rest = spaceIdx === -1 ? '' : text.slice(spaceIdx + 1).trim()
  const args = rest.length > 0 ? rest.split(/\s+/) : []

  /** Splits off the first word, keeping the remainder intact */
  const firstAndRest = (): [string, string] => {
    const idx = rest.indexOf(' ')
    return idx === -1 ? [rest, ''] : [rest.slice(0, idx), rest.slice(idx + 1).trim()]
  }

  switch (name) {
    /**
     * Send text as a message, whatever it starts with.
     *
     * What makes an alias able to produce a line beginning with a slash, and
     * the reason `//` exists as an escape in the first place.
     */
    case 'say': {
      if (!rest) return { handled: true, error: '/say needs something to say' }
      return { handled: false, message: rest }
    }

    case 'me': {
      if (!rest) return { handled: true, error: '/me needs something to do' }
      client.action(target, rest)
      return { handled: true }
    }

    case 'join':
    case 'j': {
      if (!args[0]) return { handled: true, error: 'Usage: /join #channel [key]' }
      const channel = isChannel(args[0]) ? args[0] : `#${args[0]}`
      client.join(channel, args[1])
      return { handled: true }
    }

    case 'part':
    case 'leave': {
      const channel = args[0] && isChannel(args[0]) ? args[0] : target
      const reason = args[0] && isChannel(args[0]) ? args.slice(1).join(' ') : rest
      if (!isChannel(channel)) return { handled: true, error: 'Usage: /part #channel [reason]' }
      client.part(channel, reason || undefined)
      return { handled: true }
    }

    case 'nick': {
      if (!args[0]) return { handled: true, error: 'Usage: /nick <nickname>' }
      client.setNick(args[0])
      return { handled: true }
    }

    case 'msg':
    case 'query': {
      const [to, body] = firstAndRest()
      if (!to) return { handled: true, error: 'Usage: /msg <nick|#channel> <message>' }
      if (!body) return { handled: true, error: `Nothing to send to ${to}` }
      client.say(to, body)
      return { handled: true }
    }

    case 'notice': {
      const [to, body] = firstAndRest()
      if (!to || !body) return { handled: true, error: 'Usage: /notice <target> <message>' }
      client.notice(to, body)
      return { handled: true }
    }

    case 'whois': {
      const nick = args[0]
      if (!nick) return { handled: true, error: 'Usage: /whois <nick>' }
      client.whois(nick)
      return { handled: true }
    }

    case 'topic': {
      if (!isChannel(target)) return { handled: true, error: '/topic only works in a channel' }
      if (!rest) {
        client.connection.send('TOPIC', target)
        return { handled: true }
      }
      const tooLong = tooLongFor(client, 'TOPICLEN', 'a topic', rest)
      if (tooLong) return { handled: true, error: tooLong }

      client.setTopic(target, rest)
      return { handled: true }
    }

    case 'mode': {
      if (args.length === 0) return { handled: true, error: 'Usage: /mode <target> <modes>' }

      // "/mode +o nick" applies to the current channel. Note a mode string and a
      // channel name can both start with "+", so match the mode shape first.
      if (/^[+-][a-zA-Z]+$/.test(args[0])) {
        client.mode(target, args[0], ...args.slice(1))
      } else if (args.length === 1) {
        client.connection.send('MODE', args[0])
      } else {
        client.mode(args[0], args[1], ...args.slice(2))
      }
      return { handled: true }
    }

    case 'kick': {
      if (!isChannel(target)) return { handled: true, error: '/kick only works in a channel' }
      const [nick, reason] = firstAndRest()
      if (!nick) return { handled: true, error: 'Usage: /kick <nick> [reason]' }

      const kickTooLong = reason && tooLongFor(client, 'KICKLEN', 'a kick reason', reason)
      if (kickTooLong) return { handled: true, error: kickTooLong }

      client.kick(target, nick, reason || undefined)
      return { handled: true }
    }

    case 'invite': {
      const [nick, channel] = firstAndRest()
      if (!nick) return { handled: true, error: 'Usage: /invite <nick> [#channel]' }
      client.connection.send('INVITE', nick, channel || target)
      return { handled: true }
    }

    case 'away': {
      // AWAY with no message clears it
      if (!rest) {
        client.connection.send('AWAY')
        return { handled: true }
      }

      const awayTooLong = tooLongFor(client, 'AWAYLEN', 'an away message', rest)
      if (awayTooLong) return { handled: true, error: awayTooLong }

      client.connection.send('AWAY', rest)
      return { handled: true }
    }

    case 'back': {
      client.connection.send('AWAY')
      return { handled: true }
    }

    case 'quit': {
      client.disconnect(rest || undefined)
      return { handled: true }
    }

    /**
     * Become a server operator.
     *
     * The password goes on the wire and nowhere else: the debug stream
     * redacts it (`@shared/redact`) and that stream does not leave this
     * machine at all. Worth saying because this is the one command here whose
     * argument is a credential.
     */
    case 'oper': {
      const [name, ...password] = rest.split(' ')
      if (!name || password.length === 0) {
        return { handled: true, error: 'Usage: /oper <name> <password>' }
      }
      client.connection.send('OPER', name, password.join(' '))
      return { handled: true }
    }

    case 'raw':
    case 'quote': {
      if (!rest) return { handled: true, error: 'Usage: /raw <IRC line>' }
      client.connection.sendRaw(rest)
      return { handled: true }
    }

    // ── Ranks ──────────────────────────────────────────────────────
    //
    // The everyday ones. Every client has had these for thirty years and this
    // one made you type `/mode #channel +o nick`, which is the same thing with
    // more to get wrong.

    case 'op':
    case 'deop':
    case 'voice':
    case 'devoice':
    case 'halfop':
    case 'dehalfop':
    case 'owner':
    case 'deowner':
    case 'admin':
    case 'deadmin': {
      const letters: Record<string, string> = {
        op: 'o',
        voice: 'v',
        halfop: 'h',
        owner: 'q',
        admin: 'a'
      }
      const adding = !name.startsWith('de')
      const letter = letters[adding ? name : name.slice(2)]
      const channel = isChannel(args[0]) ? args.shift()! : target
      if (!isChannel(channel)) return { handled: true, error: `/${name} only works in a channel` }

      const nicks = args.length > 0 ? args : [client.state.nick]
      // One MODE per MODES-worth, because a server that takes four at a time
      // silently drops the fifth.
      const perLine = isupportNumber(client.state.isupport, 'MODES') ?? 4
      for (let at = 0; at < nicks.length; at += perLine) {
        const batch = nicks.slice(at, at + perLine)
        client.connection.send(
          'MODE',
          channel,
          `${adding ? '+' : '-'}${letter.repeat(batch.length)}`,
          ...batch
        )
      }
      return { handled: true }
    }

    // ── Lists ──────────────────────────────────────────────────────

    case 'ban':
    case 'unban':
    case 'quiet':
    case 'unquiet': {
      const scheme = parsePrefix(client.state.isupport.PREFIX as string)
      const quieting = name.endsWith('quiet')
      const letter = quieting ? quietMode(client.state.isupport.CHANMODES as string, scheme) : 'b'
      if (!letter) {
        return { handled: true, error: 'This network does not have a quiet mode' }
      }

      const channel = isChannel(args[0]) ? args.shift()! : target
      if (!isChannel(channel)) return { handled: true, error: `/${name} only works in a channel` }
      if (args.length === 0) return { handled: true, error: `Usage: /${name} <nick or mask>` }

      const adding = !name.startsWith('un')
      for (const who of args) {
        // A bare nick becomes `nick!*@*`, which is what almost every server
        // would have done anyway and what the person plainly meant.
        client.connection.send('MODE', channel, `${adding ? '+' : '-'}${letter}`, maskToSet(who))
      }
      return { handled: true }
    }

    case 'kickban': {
      const channel = isChannel(args[0]) ? args.shift()! : target
      if (!isChannel(channel)) return { handled: true, error: '/kickban only works in a channel' }
      const who = args.shift()
      if (!who) return { handled: true, error: 'Usage: /kickban <nick> [reason]' }

      // Ban first. Kicking first leaves a window — short, but real — in which
      // they can rejoin before the ban lands, which is the one thing kickban
      // exists to prevent.
      const user = client.state.channels
        .get(client.state.casemap(channel))
        ?.users.get(client.state.casemap(who))
      client.connection.send('MODE', channel, '+b', banMask({ nick: who, host: user?.host }))
      client.connection.send('KICK', channel, who, args.join(' ') || who)
      return { handled: true }
    }

    case 'banlist':
    case 'bans': {
      const channel = isChannel(args[0]) ? args[0] : target
      if (!isChannel(channel)) return { handled: true, error: '/banlist only works in a channel' }
      client.connection.send('MODE', channel, '+b')
      return { handled: true }
    }

    // ── Channels ───────────────────────────────────────────────────

    case 'cycle':
    case 'hop': {
      const channel = isChannel(args[0]) ? args[0] : target
      if (!isChannel(channel)) return { handled: true, error: `/${name} only works in a channel` }
      client.connection.send('PART', channel)
      client.connection.send('JOIN', channel)
      return { handled: true }
    }

    case 'knock': {
      const [channel, ...why] = args
      if (!isChannel(channel)) return { handled: true, error: 'Usage: /knock <#channel> [reason]' }
      client.connection.send('KNOCK', channel, why.join(' ') || 'Please let me in')
      return { handled: true }
    }

    case 'names': {
      const channel = isChannel(args[0]) ? args[0] : target
      if (!isChannel(channel)) return { handled: true, error: '/names only works in a channel' }
      client.connection.send('NAMES', channel)
      return { handled: true }
    }

    case 'list': {
      // With no arguments this is every channel on the network, which on a
      // large one is tens of thousands of lines. The browser asks the same
      // question with a filter box, so send them there.
      if (args.length > 0) client.connection.send('LIST', ...args)
      else client.connection.send('LIST')
      return { handled: true }
    }

    // ── People ─────────────────────────────────────────────────────

    case 'whowas': {
      if (!rest) return { handled: true, error: 'Usage: /whowas <nick> [count]' }
      client.connection.send('WHOWAS', ...args)
      return { handled: true }
    }

    case 'who': {
      if (!rest) return { handled: true, error: 'Usage: /who <nick, #channel or mask>' }
      client.connection.send('WHO', ...args)
      return { handled: true }
    }

    case 'ctcp': {
      const [who, verb, ...body] = args
      if (!who || !verb) return { handled: true, error: 'Usage: /ctcp <nick> <VERSION|PING|TIME|…>' }
      client.connection.sendRaw(
        `PRIVMSG ${who} :\u0001${verb.toUpperCase()}${body.length ? ' ' + body.join(' ') : ''}\u0001`
      )
      return { handled: true }
    }

    case 'setname': {
      if (!rest) return { handled: true, error: 'Usage: /setname <real name>' }
      client.connection.send('SETNAME', rest)
      return { handled: true }
    }

    // ── The server ─────────────────────────────────────────────────

    case 'motd':
    case 'lusers':
    case 'time':
    case 'version':
    case 'links':
    case 'stats':
    case 'info':
    case 'admininfo': {
      const verb = name === 'admininfo' ? 'ADMIN' : name.toUpperCase()
      if (args.length > 0) client.connection.send(verb, ...args)
      else client.connection.send(verb)
      return { handled: true }
    }

    case 'wallops': {
      if (!rest) return { handled: true, error: 'Usage: /wallops <message>' }
      client.connection.send('WALLOPS', rest)
      return { handled: true }
    }

    case 'ping': {
      const who = args[0]
      if (who) {
        // A CTCP PING to a person, which is what /ping means everywhere —
        // stamped so the reply can be turned back into a round trip.
        client.connection.sendRaw(`PRIVMSG ${who} :\u0001PING ${Date.now()}\u0001`)
      } else {
        client.connection.send('PING', String(Date.now()))
      }
      return { handled: true }
    }

    default:
      return { handled: true, error: `Unknown command: /${name}` }
  }
}
