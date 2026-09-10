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
        status: 'SUCCESS',
        account: msg.params[1] || '',
        message: msg.params[2] || 'Account registered successfully'
      })
      break

    case 'VERIFICATION_REQUIRED':
      // Carries its own status: the account exists but cannot be used yet, and
      // a client told only "registered" would stop before asking for the code.
      client.events.emit('accountRegistered', {
        status: 'VERIFICATION_REQUIRED',
        account: msg.params[1] || '',
        message: msg.params[2] || 'Verification required — check your email'
      })
      break
  }
})

/**
 * VERIFY — the second half of registering.
 *
 * A server that wants an email confirmed answers REGISTER with
 * VERIFICATION_REQUIRED and waits for the code. Without this the flow stopped
 * there: an account was created and could never be finished.
 */
registerHandler('VERIFY', (client, msg) => {
  const outcome = msg.params[0]
  if (outcome !== 'SUCCESS') return

  client.events.emit('accountVerified', {
    account: msg.params[1] || '',
    message: msg.params[2] || 'Account verified'
  })
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

/**
 * Send the verification code the server emailed.
 */
export function verifyAccount(
  client: {
    connection: { send: (...args: string[]) => void }
    state: { capabilities: Set<string> }
  },
  account: string,
  code: string
): boolean {
  if (!client.state.capabilities.has('draft/account-registration')) {
    return false
  }

  client.connection.send('VERIFY', account, code)
  return true
}
