/**
 * Whether to log in, how, and what to say when we cannot.
 *
 * The two clients disagreed about this, quietly and in a way nobody would
 * guess from the settings screen: the phone authenticated whenever a password
 * was saved and defaulted the mechanism to PLAIN, and the desktop authenticated
 * only when a mechanism had been chosen and never checked there was a password
 * to send. So one config could log in on one device and sit there as a stranger
 * on the other, with no message on either.
 *
 * The decision is here now, and both ask it the same question.
 */

export interface SaslConfig {
  /** What the user picked, or null for "work it out" */
  mechanism: string | null
  /** The account name, or null to use the nick */
  username: string | null
  password: string | null
  /** A client certificate, which is the credential EXTERNAL uses instead */
  clientCert: string | null
  /** Credentials that are stored and cannot be read back */
  unreadable?: string[]
}

export type SaslPlan =
  /** Send `AUTHENTICATE <mechanism>` and carry on */
  | { action: 'authenticate'; mechanism: string }
  /** Nothing was set up. Not an error — plenty of networks need no account. */
  | { action: 'skip' }
  /** Set up, and cannot work. Say so rather than let the server answer 904. */
  | { action: 'refuse'; reason: string }

/** The mechanism that needs a certificate rather than a password */
const EXTERNAL = 'EXTERNAL'

/**
 * What to do about logging in.
 *
 * [offered] is the capability's value split out — `sasl=PLAIN,SCRAM-SHA-256` —
 * or null where the server named none, which the spec allows and means "ask
 * and find out".
 */
export function saslPlan(config: SaslConfig, offered: string[] | null): SaslPlan {
  const chosen = config.mechanism?.trim().toUpperCase() || null

  // Nothing chosen: PLAIN if there is a password to send with it, and
  // otherwise nothing at all. Working it out is what the phone always did,
  // and it is the behaviour somebody who filled in a username and a password
  // is expecting — those two fields are the whole of what PLAIN needs.
  const mechanism = chosen ?? (config.password ? 'PLAIN' : null)
  if (!mechanism) return { action: 'skip' }

  // A credential that is stored and cannot be read back is not a credential.
  // Authenticating with an empty string instead produces a 904 and blames the
  // server for refusing a password it was never sent.
  if (config.unreadable?.includes('saslPassword')) {
    return {
      action: 'refuse',
      reason:
        'Your saved password for this network could not be read — it was encrypted by a ' +
        'keyring this computer no longer has. Enter it again in the network settings.'
    }
  }

  if (mechanism === EXTERNAL) {
    if (!config.clientCert) {
      return {
        action: 'refuse',
        reason: 'SASL EXTERNAL needs a client certificate, and this network has none set up.'
      }
    }
  } else if (!config.password) {
    return {
      action: 'refuse',
      reason: `SASL ${mechanism} needs a password, and this network has none saved.`
    }
  }

  // What the server says it will take. Sending something not on the list gets
  // a bare 904 and somebody staring at "authentication failed" with no way to
  // know their account was never the problem.
  if (offered && offered.length > 0 && !offered.includes(mechanism)) {
    return {
      action: 'refuse',
      reason: `This server does not offer ${mechanism}. It accepts ${offered.join(', ')}.`
    }
  }

  return { action: 'authenticate', mechanism }
}

/** The account name to authenticate as, which falls back to the nick */
export function saslAccount(config: SaslConfig, nick: string): string {
  return config.username?.trim() || nick
}
