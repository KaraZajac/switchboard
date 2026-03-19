import { registerHandler } from '../handlers/registry'
import type { ChannelUser } from '@shared/types/channel'

/**
 * WHOX — Extended WHO responses.
 *
 * Client sends: WHO <mask> %tcuhsnfadlor[,token]
 * Server responds: RPL_WHOSPCRPL (354) with requested fields.
 *
 * We use a standard field set: %tcuhsnfar,switchboard
 * t=token, c=channel, u=user, h=host, s=server, n=nick, f=flags, a=account, r=realname
 */

/** Token we use to identify our WHOX requests */
export const WHOX_TOKEN = 'switchboard'

/** Send a WHOX query for a channel */
export function sendWHOX(
  client: { connection: { send: (...args: string[]) => void }; state: { isupport: Record<string, string | true> } },
  channel: string
): void {
  // Check if WHOX is supported
  if (client.state.isupport['WHOX'] === true || client.state.isupport['WHOX']) {
    client.connection.send('WHO', channel, `%tcuhsnfar,${WHOX_TOKEN}`)
  } else {
    // Fallback to regular WHO
    client.connection.send('WHO', channel)
  }
}

/**
 * RPL_WHOSPCRPL (354) — WHOX response
 */
registerHandler('354', (client, msg) => {
  // Fields depend on what we requested. With %tcuhsnfar,switchboard:
  // params: <nick> <token> <channel> <user> <host> <server> <nick> <flags> <account> <realname>
  const params = msg.params

  // Verify it's our request
  if (params.length < 10 || params[1] !== WHOX_TOKEN) return

  const channel = params[2]
  const user = params[3]
  const host = params[4]
  // params[5] = server (not needed for user list)
  const nick = params[6]
  const flags = params[7]
  const account = params[8] === '0' ? null : params[8]
  const realname = params[9]

  const ch = client.state.channels.get(channel.toLowerCase())
  if (!ch) return

  // Parse flags: H=here, G=gone(away), *=ircop, @+=prefixes, B=bot
  const isAway = flags.includes('G')
  const isBot = flags.includes('B')

  const prefixes: string[] = []
  const prefixChars = ['~', '&', '@', '%', '+']
  for (const char of flags) {
    if (prefixChars.includes(char)) {
      prefixes.push(char)
    }
  }

  ch.setUser(nick, {
    nick,
    user,
    host,
    account,
    realname,
    prefixes,
    away: isAway,
    isBot
  })
})

/**
 * RPL_ENDOFWHO (315) — End of WHO list
 */
registerHandler('315', (client, msg) => {
  const channel = msg.params[1]
  const ch = client.state.channels.get(channel?.toLowerCase())
  if (ch) {
    const users: ChannelUser[] = Array.from(ch.users.values())
    client.events.emit('names', { channel: ch.name, users })
  }
})
