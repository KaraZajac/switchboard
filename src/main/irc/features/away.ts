import { registerHandler } from '../handlers/registry'

/**
 * away-notify — Live away status updates.
 * :nick!user@host AWAY :reason   (going away)
 * :nick!user@host AWAY           (returning)
 */
registerHandler('AWAY', (client, msg) => {
  const nick = msg.source?.nick || ''
  const message = msg.params[0] || null
  const isAway = message !== null

  // Update away status in all channels
  for (const [, channel] of client.state.channels) {
    const user = channel.users.get(client.state.casemap(nick))
    if (user) {
      user.away = isAway
      user.awayMessage = message
    }
  }

  client.events.emit('away', { nick, message })
})

/**
 * RPL_UNAWAY (305) — We are no longer away
 */
registerHandler('305', (client, _msg) => {
  client.state.away = false
  client.events.emit('away', { nick: client.state.nick, message: null })
})

/**
 * RPL_NOWAWAY (306) — We are now away
 */
registerHandler('306', (client, msg) => {
  client.state.away = true
  client.events.emit('away', {
    nick: client.state.nick,
    message: msg.params[1] || 'Away'
  })
})

/**
 * RPL_AWAY (301) — they are away, and this is what they said.
 *
 * The reply to messaging somebody who is not there. `away-notify` only tells
 * you about people you share a channel with; this is how a network answers for
 * anyone else, and it is the only notice you get that the message you just
 * sent is going to sit unread. Nothing read it on the desktop.
 *
 * `<client> <nick> :<message>`
 */
registerHandler('301', (client, msg) => {
  const nick = msg.params[1]
  if (!nick) return

  const message = msg.params[2] || null

  for (const [, channel] of client.state.channels) {
    const user = channel.users.get(client.state.casemap(nick))
    if (user) {
      user.away = true
      user.awayMessage = message
    }
  }

  client.events.emit('away', { nick, message })
})
