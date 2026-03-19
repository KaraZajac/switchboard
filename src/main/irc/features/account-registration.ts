import { registerHandler } from '../handlers/registry'

/**
 * draft/account-registration — Register an account from the client.
 *
 * Client sends: REGISTER * <email> <password>
 * Server replies:
 *   REGISTER SUCCESS <account> <message>
 *   REGISTER VERIFICATION_REQUIRED <account> <message>
 *   FAIL REGISTER <code> <context> <message>
 */

registerHandler('REGISTER', (client, msg) => {
  // Server response to our REGISTER attempt
  const subcommand = msg.params[0]

  switch (subcommand) {
    case 'SUCCESS':
      client.events.emit('accountRegistered', {
        account: msg.params[1] || '',
        message: msg.params[2] || 'Account registered successfully'
      })
      break

    case 'VERIFICATION_REQUIRED':
      client.events.emit('accountRegistered', {
        account: msg.params[1] || '',
        message: msg.params[2] || 'Verification required — check your email'
      })
      break
  }
})

/**
 * Send a REGISTER command to create an account.
 */
export function registerAccount(
  client: {
    connection: { send: (...args: string[]) => void }
    state: { capabilities: Set<string> }
  },
  email: string | null,
  password: string
): boolean {
  if (!client.state.capabilities.has('draft/account-registration')) {
    return false
  }

  client.connection.send('REGISTER', '*', email || '*', password)
  return true
}
