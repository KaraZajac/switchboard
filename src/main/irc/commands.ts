import type { IRCClient } from './client'
import { isupportNumber, fitsLimit } from '@shared/isupport'

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

    default:
      return { handled: true, error: `Unknown command: /${name}` }
  }
}
