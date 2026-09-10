import type { SASLMechanism } from './types/irc'

/**
 * What a network will let you do about an account.
 *
 * IRC has two answers and they need different screens. A modern server
 * advertises `draft/account-registration` and the whole thing can happen in the
 * client. Everywhere else there is a bot called NickServ that you talk to in
 * English, and the client's job is to know the phrases and save the password.
 *
 * Nothing here is guessed: a client that offers to register on a network that
 * will not is offering a dead end. The Kotlin half is `accountAbilities` in
 * `EngineActions.kt`, and both are checked against `tests/fixtures/accounts.json`.
 */

export interface AccountAbilities {
  /** The server will create an account for us over the protocol */
  canRegister: boolean
  /** It insists on an email address it can send a code to */
  emailRequired: boolean
  /** Shortest password it will take, when it said */
  minPasswordLength: number | null
  /** It will let us register before we are even on the network */
  beforeConnect: boolean
  /** SASL mechanisms it offers, so a saved password can be used at connect */
  saslMechanisms: string[]
}

/**
 * Read the capability values, which is where all of this is stated.
 *
 * `draft/account-registration=before-connect,email-required,min-password-length=10`
 * and `sasl=PLAIN,SCRAM-SHA-256`. A capability present with no value still means
 * the feature is there — it simply said nothing about its limits.
 */
export function accountAbilities(values: Record<string, string>): AccountAbilities {
  const registration = values['draft/account-registration']
  const parts =
    registration === undefined ? [] : registration.split(',').map((p) => p.trim())

  const minimum = parts
    .find((p) => p.startsWith('min-password-length='))
    ?.split('=')[1]

  return {
    canRegister: registration !== undefined,
    emailRequired: parts.includes('email-required'),
    minPasswordLength: minimum ? Number(minimum) || null : null,
    beforeConnect: parts.includes('before-connect'),
    saslMechanisms: (values['sasl'] ?? '')
      .split(',')
      .map((m) => m.trim().toUpperCase())
      .filter((m) => m.length > 0)
  }
}

/**
 * The mechanism to save a password under.
 *
 * SCRAM by preference, because the password never crosses the wire; PLAIN
 * where that is all there is. Null means the network offers neither, and the
 * password has to go to NickServ as a message instead.
 */
export function bestSaslMechanism(mechanisms: string[]): SASLMechanism | null {
  // Strongest first. Libera offers SHA-512 and not SHA-256, so a client that
  // only knew the one fell back to PLAIN there — which works, and sends the
  // password to a server that never needed to see it.
  if (mechanisms.includes('SCRAM-SHA-512')) return 'SCRAM-SHA-512'
  if (mechanisms.includes('SCRAM-SHA-256')) return 'SCRAM-SHA-256'
  if (mechanisms.includes('PLAIN')) return 'PLAIN'
  return null
}

/**
 * Whether both devices can be on this network at the same time.
 *
 * IRC lets two connections share one nick when the server says so, and the
 * server's condition is always the same: both must have authenticated to the
 * same account. rIRCd states it plainly — `same_account && multiclient` — and
 * every implementation of the idea works that way, because the account is the
 * only thing that makes the second connection *you* rather than an impostor.
 *
 * So the client's test is the precondition, not the permission: do we have
 * credentials to arrive as? Whether the network then allows it is the network's
 * answer, and it gives that answer by letting us keep the nick or not. A device
 * that asked and was refused falls back to following the other one.
 *
 * A saved identify command is not enough. NickServ logs you in *after*
 * registration, by which time the nick has already been refused.
 */
export function canShareConnection(config: {
  saslMechanism: string | null
  saslPassword: string | null
}): boolean {
  return !!config.saslMechanism && !!config.saslPassword
}

/**
 * Which half of the account screen to show.
 *
 * Four states, and getting them in the right order matters more than any of
 * them individually: a network that has not been reached yet cannot be asked
 * what it can do, and somebody already logged in should not be offered a
 * registration form for the nick they are logged in as.
 *
 * Both clients render the same four, so the choice between them belongs
 * somewhere both can reach.
 */
export type AccountView =
  /** Not on the network yet, so nothing is known about what it can do */
  | 'offline'
  /** Logged in, and the credentials are saved for next time */
  | 'settled'
  /** Logged in for now, with nothing saved to do it again */
  | 'remember'
  /** The network will make an account for us */
  | 'register'
  /** It will not, so this is a conversation with NickServ */
  | 'nickserv'

export function accountView(state: {
  connected: boolean
  account: string | null
  remembered: boolean
  canRegister: boolean
}): AccountView {
  if (!state.connected) return 'offline'
  if (state.account) return state.remembered ? 'settled' : 'remember'
  return state.canRegister ? 'register' : 'nickserv'
}
