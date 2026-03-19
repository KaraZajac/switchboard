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
    const user = channel.users.get(nick.toLowerCase())
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
  client.events.emit('away', { nick: client.state.nick, message: null })
})

/**
 * RPL_NOWAWAY (306) — We are now away
 */
registerHandler('306', (client, msg) => {
  client.events.emit('away', {
    nick: client.state.nick,
    message: msg.params[1] || 'Away'
  })
})
