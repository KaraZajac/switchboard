import { registerHandler } from './handlers/registry'
import { saslPlan } from '@shared/saslplan'
import { REQUESTED_CAPS } from '@shared/constants'
import { parseSTSValue, setSTSPolicy } from './features/sts'

/**
 * CAP — IRCv3 Capability Negotiation (v302)
 *
 * Flow:
 * 1. Client sends: CAP LS 302
 * 2. Server responds: CAP * LS :cap1 cap2=value cap3
 *    (may be multi-line with * continuation)
 * 3. Client sends: CAP REQ :cap1 cap2 cap3
 * 4. Server responds: CAP * ACK :cap1 cap2 cap3
 * 5. (SASL auth happens here if negotiated)
 * 6. Client sends: CAP END
 */

registerHandler('CAP', (client, msg) => {
  // params: <nick-or-*> <subcommand> [* (multiline)] :<cap list>
  const subcommand = msg.params[1]?.toUpperCase()

  // What the server will put in front of its answer. The REQ has to leave
  // room for it — see `requestCapabilities`.
  const reply = { server: msg.prefix ?? '', nick: msg.params[0] ?? '*' }

  switch (subcommand) {
    case 'LS': {
      // Check for multiline continuation (the * before the trailing param)
      const isMultiline = msg.params[2] === '*'
      const capStr = isMultiline ? msg.params[3] : msg.params[2]

      if (!capStr) break

      // The accumulator lives on the connection, not the module: two networks
      // connecting at once — which is every launch with more than one — would
      // otherwise pour their lists into one map and each ask for the other's.
      const pendingCapLs = client.state.pendingCapLs

      // Parse capabilities: "cap1 cap2=value cap3"
      for (const token of capStr.split(' ')) {
        if (!token) continue
        const eqIdx = token.indexOf('=')
        if (eqIdx === -1) {
          pendingCapLs.set(token, null)
        } else {
          pendingCapLs.set(token.slice(0, eqIdx), token.slice(eqIdx + 1))
        }
      }

      if (isMultiline) {
        return // Wait for more lines
      }

      // All caps received — store and request what we want
      client.state.availableCapabilities = new Map(pendingCapLs)

      // Handle STS — if server advertises sts, enforce TLS upgrade
      const stsValue = pendingCapLs.get('sts')
      if (stsValue) {
        const sts = parseSTSValue(stsValue)
        if (sts) {
          setSTSPolicy(client.config.host, sts.port, sts.duration)

          // If we're on a plaintext connection, disconnect and reconnect via TLS
          if (!client.config.tls) {
            client.events.emit('stsUpgrade', {
              host: client.config.host,
              port: sts.port,
              duration: sts.duration
            })

            // Move this server onto TLS before dropping the socket, so the
            // reconnect that follows comes back secured. Without it the retry
            // dialled plaintext again and the two sides argued for ever.
            client.config.port = sts.port
            client.config.tls = true
            client.connection.disconnect('STS upgrade required')
            pendingCapLs.clear()
            return
          }
        }
      }

      // Determine which caps to request
      const toRequest: string[] = []
      for (const cap of REQUESTED_CAPS) {
        if (pendingCapLs.has(cap)) {
          toRequest.push(cap)
        }
      }

      // Reset accumulator
      pendingCapLs.clear()

      if (toRequest.length > 0) {
        requestCapabilities(client, toRequest, reply)
      } else {
        // Nothing to negotiate — end cap negotiation
        client.connection.send('CAP', 'END')
        client.state.capNegotiating = false
      }
      break
    }

    case 'ACK': {
      // Server acknowledged our requested caps. Like LS, an ACK may be spread
      // over several lines, a `*` before the list meaning more are coming;
      // the spec says not to act until the last of the set arrives.
      const ackContinues = msg.params[2] === '*'
      const capStr = (ackContinues ? msg.params[3] : msg.params[2]) || ''
      for (const cap of capStr.split(' ')) {
        if (!cap) continue
        // A leading '-' means the cap was removed (from CAP NEW/DEL flow)
        if (cap.startsWith('-')) {
          client.state.capabilities.delete(cap.slice(1))
        } else {
          client.state.capabilities.add(cap)
        }
      }
      if (ackContinues) break

      // A long wish list goes out as several CAP REQ lines; registration must
      // not proceed until the last one has been answered.
      if (client.state.pendingCapRequests > 0) client.state.pendingCapRequests--
      if (client.state.pendingCapRequests > 0) break

      // draft/pre-away: set away before registration completes (bouncer support)
      if (client.state.capabilities.has('draft/pre-away') && client.config.preAwayMessage) {
        client.connection.send('AWAY', client.config.preAwayMessage)
      }

      // If SASL was acknowledged, we authenticate before CAP END.
      //
      // Whether to, and with what, is `saslPlan` — shared, because this used
      // to be decided differently here and on the phone: one config logged in
      // on one device and sat there as a stranger on the other, and nothing on
      // either screen said why.
      if (client.state.capabilities.has('sasl')) {
        const plan = saslPlan(
          {
            mechanism: client.config.saslMechanism,
            username: client.config.saslUsername,
            password: client.config.saslPassword,
            clientCert: client.config.clientCert,
            unreadable: client.config.unreadableSecrets
          },
          saslMechanismsFrom(client.state.availableCapabilities.get('sasl'))
        )

        if (plan.action === 'refuse') {
          client.events.emit('error', { code: 'SASL', message: plan.reason })
          client.connection.send('CAP', 'END')
          client.state.capNegotiating = false
          client.events.emit('capNegotiated', Array.from(client.state.capabilities))
          break
        }

        if (plan.action === 'authenticate') {
          client.connection.send('AUTHENTICATE', plan.mechanism)
          client.events.emit('capNegotiated', Array.from(client.state.capabilities))
          // Don't send CAP END yet — the SASL handler does it after the exchange
          return
        }
      }

      // No SASL needed — end negotiation
      client.connection.send('CAP', 'END')
      client.state.capNegotiating = false
      client.events.emit('capNegotiated', Array.from(client.state.capabilities))
      break
    }

    case 'NAK': {
      // Server rejected our cap request. Everything in that line is refused
      // together, so there is nothing to salvage from it — but any other lines
      // we sent are still outstanding.
      if (client.state.pendingCapRequests > 0) client.state.pendingCapRequests--
      if (client.state.pendingCapRequests > 0) break

      client.connection.send('CAP', 'END')
      client.state.capNegotiating = false
      client.events.emit('capNegotiated', Array.from(client.state.capabilities))
      break
    }

    case 'NEW': {
      // Server is advertising new capabilities (cap-notify)
      const capStr = msg.params[2] || ''
      const newCaps: string[] = []

      for (const token of capStr.split(' ')) {
        if (!token) continue
        const eqIdx = token.indexOf('=')
        const name = eqIdx === -1 ? token : token.slice(0, eqIdx)
        const value = eqIdx === -1 ? null : token.slice(eqIdx + 1)
        client.state.availableCapabilities.set(name, value)

        // Auto-request if it's in our wanted list
        if (REQUESTED_CAPS.includes(name as (typeof REQUESTED_CAPS)[number])) {
          newCaps.push(name)
        }
      }

      if (newCaps.length > 0) {
        requestCapabilities(client, newCaps, reply)
      }
      break
    }

    case 'DEL': {
      // Server is removing capabilities (cap-notify)
      const capStr = msg.params[2] || ''
      for (const cap of capStr.split(' ')) {
        if (!cap) continue
        client.state.capabilities.delete(cap)
        client.state.availableCapabilities.delete(cap)
      }
      break
    }

    case 'LIST': {
      // Response to CAP LIST — informational only
      break
    }
  }
})

/**
 * The IRC line limit, in bytes, including the trailing CRLF.
 *
 * RFC 1459 and every server since. A few advertise more via the LINELEN
 * ISUPPORT token, but that arrives long after capability negotiation, so this
 * is the only budget available when it matters most.
 */
const MAX_LINE_BYTES = 512

/**
 * The mechanisms the server named, or null if it named none.
 *
 * `sasl` with no value means the server will take whatever it takes and has
 * not said what — which is not the same as taking nothing, so the caller has
 * to go ahead and find out.
 */
export function saslMechanismsFrom(value: string | null | undefined): string[] | null {
  if (!value) return null
  const named = value
    .split(',')
    .map((mechanism) => mechanism.trim().toUpperCase())
    .filter(Boolean)
  return named.length > 0 ? named : null
}

/**
 * The longest a server name can be when we have not yet heard it.
 *
 * RFC 1035 caps a single hostname label at 63 octets; a server name is
 * normally one hostname of a few labels, and a placeholder this generous
 * costs a second REQ line only on a network that offers a great many
 * capabilities — which is exactly where the room is needed.
 */
const UNKNOWN_SERVER_NAME_BYTES = 63

/**
 * How the server will answer: `:<server> CAP <nick> ACK :<what we asked>`.
 *
 * Everything we know about that at REQ time, which is the prefix and the
 * nick parameter of the CAP LS we are answering. Before registration most
 * servers put `*` where the nick goes, some put the nick already; the budget
 * takes the longer.
 */
export interface CapReplyShape {
  server: string
  nick: string
}

/**
 * Ask for capabilities, in as many CAP REQ lines as it takes.
 *
 * A wish list that has grown past the line limit is not a small problem: the
 * server answers `417 ERR_INPUTTOOLONG`, registration never completes, and the
 * client simply never connects. The capability-negotiation spec requires the
 * split, and each CAP REQ is atomic — the server ACKs or NAKs a whole line — so
 * splitting changes nothing except that it fits.
 *
 * It is the *answer* that has to fit, not the question. The spec: "Clients
 * SHOULD ensure that their list of requested capabilities is not too long to
 * be replied to with a single ACK or NAK message." The ACK repeats the list
 * behind `:irc.example.org CAP * ACK :`, which is longer than our `CAP REQ :`
 * by the server's name and then some. A REQ that fit with two bytes to spare
 * came back as an ACK cut off mid-word at the limit, and the capability that
 * was cut — the last one asked for — was silently never enabled.
 */
export function requestCapabilities(
  client: {
    connection: { send: (...args: string[]) => void }
    state: { pendingCapRequests: number }
  },
  caps: string[],
  reply?: CapReplyShape
): void {
  const server = reply?.server || '?'.repeat(UNKNOWN_SERVER_NAME_BYTES)
  const nick = (reply?.nick || '*').length > 1 ? reply!.nick : '*'
  const ackPrefix = `:${server} CAP ${nick} ACK :`
  const budget = MAX_LINE_BYTES - Buffer.byteLength(ackPrefix) - 2 // CRLF

  const lines: string[] = []
  let current = ''
  for (const cap of caps) {
    const candidate = current === '' ? cap : `${current} ${cap}`
    if (Buffer.byteLength(candidate) > budget && current !== '') {
      lines.push(current)
      current = cap
    } else {
      current = candidate
    }
  }
  if (current !== '') lines.push(current)

  client.state.pendingCapRequests = lines.length
  for (const line of lines) {
    client.connection.send('CAP', 'REQ', line)
  }
}
