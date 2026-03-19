import { registerHandler } from '../handlers/registry'

/**
 * setname — Handle realname changes.
 * :nick!user@host SETNAME :New Real Name
 */
registerHandler('SETNAME', (client, msg) => {
  const nick = msg.source?.nick || ''
  const newRealname = msg.params[0] || ''

  // Update in all channels
  for (const [, channel] of client.state.channels) {
    const user = channel.users.get(nick.toLowerCase())
    if (user) {
      user.realname = newRealname
    }
  }

  client.events.emit('setname', { nick, realname: newRealname })
})
