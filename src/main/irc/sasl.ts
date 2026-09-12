import { registerHandler } from './handlers/registry'
import { SASL_CHUNK_SIZE } from '@shared/constants'
import { beginScramAuth, handleScramChallenge, isScramInProgress, scramDigest } from './scram'

/**
 * SASL Authentication (IRCv3 3.1/3.2)
 *
 * Flow:
 * 1. CAP ACK includes 'sasl'
 * 2. Client sends: AUTHENTICATE <mechanism>
 * 3. Server responds: AUTHENTICATE +
 * 4. Client sends: AUTHENTICATE <base64-payload>
 *    (chunked in 400-byte pieces; empty = AUTHENTICATE +)
 * 5. Server responds: 900 (logged in), 903 (success) or 904 (failure)
 * 6. Client sends: CAP END
 */

registerHandler('AUTHENTICATE', (client, msg) => {
  const param = msg.params[0]

  // If SCRAM exchange is in progress, forward the challenge
  if (isScramInProgress() && param !== '+') {
    handleScramChallenge(client, param)
    return
  }

  if (param === '+') {
    const mechanism = client.config.saslMechanism

    if (mechanism === 'PLAIN') {
      const username = client.config.saslUsername || client.config.nick

      /*
       * A password that is stored and cannot be read back is not a password.
       *
       * `decryptSecret` returns null both for "nothing saved" and for "saved
       * under a key this machine no longer has" — a moved profile, a reset
       * keyring. Treating the second as the first meant authenticating with an
       * empty string, which the server refuses, which arrived on screen as
       * "SASL authentication failed" — the server blamed for turning down a
       * password we never sent it.
       */
      if (client.config.unreadableSecrets?.includes('saslPassword')) {
        abortSasl(
          client,
          'Your saved password for this network could not be read — it was ' +
            'encrypted by a keyring this computer no longer has. Enter it again ' +
            'in the network settings.'
        )
        return
      }

      const password = client.config.saslPassword || ''

      // PLAIN format: \0<username>\0<password>
      const payload = `\0${username}\0${password}`
      const encoded = Buffer.from(payload, 'utf8').toString('base64')
      sendChunked(client, encoded)
    } else if (mechanism === 'EXTERNAL') {
      // EXTERNAL uses the TLS client certificate — send empty auth
      client.connection.sendRaw('AUTHENTICATE +')
    } else if (mechanism && scramDigest(mechanism)) {
      beginScramAuth(client, mechanism)
    }
  } else if (isScramInProgress()) {
    // Server challenge during SCRAM exchange
    handleScramChallenge(client, param)
  }
})

/**
 * RPL_LOGGEDIN (900) — Successfully authenticated
 */
registerHandler('900', (client, msg) => {
  // params: <nick> <nick!user@host> <account> :You are now logged in as <account>
  const account = msg.params[2]
  client.state.account = account ?? null

  // Announced as well as recorded. Nothing above the connection could say whose
  // account this was, which is the one fact an account screen exists for — and
  // the one thing a second device has to match before a server will let it in
  // under the same nick.
  client.events.emit('account', { nick: client.state.nick, account: account ?? null })
  client.events.emit('note', {
    code: '900',
    command: 'SASL',
    message: `Logged in as ${account}`
  })
})

/**
 * RPL_LOGGEDOUT (901) — no longer authenticated
 */
registerHandler('901', (client, _msg) => {
  client.state.account = null
  client.events.emit('account', { nick: client.state.nick, account: null })
})

/**
 * Give up on SASL before sending anything, and say why.
 *
 * `AUTHENTICATE *` is how the spec says a client abandons an exchange it has
 * started, and CAP has to be ended either way or registration never finishes —
 * the connection would sit there with the server waiting for a CAP END that
 * was not coming.
 *
 * The connection continues unauthenticated, which is the same place a wrong
 * password leaves you, except that this time the message says what to do.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function abortSasl(client: any, message: string): void {
  client.connection.sendRaw('AUTHENTICATE *')
  client.events.emit('error', { code: 'SASL', command: 'SASL', message })
  client.connection.send('CAP', 'END')
  client.state.capNegotiating = false
}

/**
 * RPL_SASLSUCCESS (903) — SASL authentication succeeded
 */
registerHandler('903', (client, _msg) => {
  // Take the name we actually asked for, now that there is an account behind
  // the request.
  //
  // A server that protects registered nicks refuses one to a connection that
  // has not authenticated yet — rIRCd answers 433 "Nickname is registered to
  // another account" — and since NICK goes out before SASL can even begin,
  // that is the ordinary case for anyone with an account, not a corner of one.
  // The recovery loop would get there in the end, but twenty seconds later and
  // after auto-join has already joined everything under the wrong name.
  reclaimDesiredNick(client)

  // End CAP negotiation now that SASL is done
  client.connection.send('CAP', 'END')
  client.state.capNegotiating = false
})

/** Ask again for the nick we wanted, if we settled for another one */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function reclaimDesiredNick(client: any): void {
  const { state } = client
  if (!state.desiredNick) return
  if (state.casemap(state.nick) === state.casemap(state.desiredNick)) return

  state.pendingNick = state.desiredNick
  client.connection.send('NICK', state.desiredNick)
}

/**
 * ERR_SASLFAIL (904) — SASL authentication failed
 */
/**
 * ERR_NICKLOCKED (902) — the account is there, and this nick is not yours.
 *
 * A distinct failure from a wrong password, and one with a different fix: the
 * nick belongs to somebody else's account, so no amount of retyping helps.
 * The phone has always said so.
 */
registerHandler('902', (client, msg) => {
  client.events.emit('error', {
    code: '902',
    command: 'SASL',
    message: msg.params[msg.params.length - 1] || 'That nick belongs to another account'
  })
})

registerHandler('904', (client, msg) => {
  client.events.emit('error', {
    code: '904',
    command: 'SASL',
    message: msg.params[1] || 'SASL authentication failed'
  })
  // End CAP negotiation anyway — we can't authenticate
  client.connection.send('CAP', 'END')
  client.state.capNegotiating = false
})

/**
 * ERR_SASLTOOLONG (905) — SASL payload too long
 */
registerHandler('905', (client, msg) => {
  client.events.emit('error', {
    code: '905',
    command: 'SASL',
    message: msg.params[1] || 'SASL message too long'
  })
  client.connection.send('CAP', 'END')
  client.state.capNegotiating = false
})

/**
 * ERR_SASLABORTED (906) — SASL authentication aborted
 */
registerHandler('906', (client, _msg) => {
  client.connection.send('CAP', 'END')
  client.state.capNegotiating = false
})

/**
 * ERR_SASLALREADY (907) — Already authenticated
 */
registerHandler('907', (client, _msg) => {
  client.connection.send('CAP', 'END')
  client.state.capNegotiating = false
})

/**
 * RPL_SASLMECHS (908) — Available SASL mechanisms
 */
registerHandler('908', (client, msg) => {
  // params: <nick> <mechanisms> :are available SASL mechanisms
  const mechanisms = msg.params[1] || ''
  client.events.emit('note', {
    code: '908',
    command: 'SASL',
    message: `Available SASL mechanisms: ${mechanisms}`
  })
})

// ── Helpers ────────────────────────────────────────────────────────

function sendChunked(
  client: { connection: { sendRaw: (line: string) => void } },
  encoded: string
): void {
  // Send in 400-byte chunks
  for (let i = 0; i < encoded.length; i += SASL_CHUNK_SIZE) {
    const chunk = encoded.slice(i, i + SASL_CHUNK_SIZE)
    client.connection.sendRaw(`AUTHENTICATE ${chunk}`)
  }
  // If the payload was exactly a multiple of 400, send AUTHENTICATE + to signal end
  if (encoded.length % SASL_CHUNK_SIZE === 0) {
    client.connection.sendRaw('AUTHENTICATE +')
  }
}
