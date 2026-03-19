import { registerHandler } from '../handlers/registry'

/**
 * account-notify — Track user login/logout across shared channels.
 * :nick!user@host ACCOUNT accountname  (login)
 * :nick!user@host ACCOUNT *            (logout)
 */
registerHandler('ACCOUNT', (client, msg) => {
  const nick = msg.source?.nick || ''
  const account = msg.params[0] === '*' ? null : msg.params[0]

  // Update account in all channels this user is in
  for (const [, channel] of client.state.channels) {
    const user = channel.users.get(nick.toLowerCase())
    if (user) {
      user.account = account
    }
  }

  client.events.emit('account', { nick, account })
})
