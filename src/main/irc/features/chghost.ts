import { registerHandler } from '../handlers/registry'

/**
 * chghost — Handle user/host changes without fake QUIT/JOIN.
 * :nick!olduser@oldhost CHGHOST newuser newhost
 */
registerHandler('CHGHOST', (client, msg) => {
  const nick = msg.source?.nick || ''
  const newUser = msg.params[0]
  const newHost = msg.params[1]

  // Update in all channels
  for (const [, channel] of client.state.channels) {
    const user = channel.users.get(nick.toLowerCase())
    if (user) {
      user.user = newUser
      user.host = newHost
    }
  }

  client.events.emit('chghost', { nick, newUser, newHost })
})
