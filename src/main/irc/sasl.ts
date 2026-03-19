import { registerHandler } from './handlers/registry'
import { SASL_CHUNK_SIZE } from '@shared/constants'
import { beginScramAuth, handleScramChallenge, isScramInProgress } from './scram'

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
      const password = client.config.saslPassword || ''

      // PLAIN format: \0<username>\0<password>
      const payload = `\0${username}\0${password}`
      const encoded = Buffer.from(payload, 'utf8').toString('base64')
      sendChunked(client, encoded)

    } else if (mechanism === 'EXTERNAL') {
      // EXTERNAL uses the TLS client certificate — send empty auth
      client.connection.sendRaw('AUTHENTICATE +')

    } else if (mechanism === 'SCRAM-SHA-256') {
      beginScramAuth(client)
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
  client.events.emit('note', {
    code: '900',
    command: 'SASL',
    message: `Logged in as ${account}`
  })
})

/**
 * RPL_SASLSUCCESS (903) — SASL authentication succeeded
 */
registerHandler('903', (client, _msg) => {
  // End CAP negotiation now that SASL is done
  client.connection.send('CAP', 'END')
  client.state.capNegotiating = false
})

/**
 * ERR_SASLFAIL (904) — SASL authentication failed
 */
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
