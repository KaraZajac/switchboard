import { registerHandler } from './handlers/registry'
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

// Accumulator for multi-line CAP LS responses
let pendingCapLs: Map<string, string | null> = new Map()

registerHandler('CAP', (client, msg) => {
  // params: <nick-or-*> <subcommand> [* (multiline)] :<cap list>
  const subcommand = msg.params[1]?.toUpperCase()

  switch (subcommand) {
    case 'LS': {
      // Check for multiline continuation (the * before the trailing param)
      const isMultiline = msg.params[2] === '*'
      const capStr = isMultiline ? msg.params[3] : msg.params[2]

      if (!capStr) break

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
            pendingCapLs = new Map()
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
      pendingCapLs = new Map()

      if (toRequest.length > 0) {
        requestCapabilities(client, toRequest)
      } else {
        // Nothing to negotiate — end cap negotiation
        client.connection.send('CAP', 'END')
        client.state.capNegotiating = false
      }
      break
    }

    case 'ACK': {
      // Server acknowledged our requested caps
      const capStr = msg.params[2] || ''
      for (const cap of capStr.split(' ')) {
        if (!cap) continue
        // A leading '-' means the cap was removed (from CAP NEW/DEL flow)
        if (cap.startsWith('-')) {
          client.state.capabilities.delete(cap.slice(1))
        } else {
          client.state.capabilities.add(cap)
        }
      }

      // A long wish list goes out as several CAP REQ lines; registration must
      // not proceed until the last one has been answered.
      if (client.state.pendingCapRequests > 0) client.state.pendingCapRequests--
      if (client.state.pendingCapRequests > 0) break

      // draft/pre-away: set away before registration completes (bouncer support)
      if (client.state.capabilities.has('draft/pre-away') && client.config.preAwayMessage) {
        client.connection.send('AWAY', client.config.preAwayMessage)
      }

      // If SASL was acknowledged, we need to authenticate before CAP END
      if (client.state.capabilities.has('sasl') && client.config.saslMechanism) {
        // Send AUTHENTICATE <mechanism> to begin SASL auth
        client.connection.send('AUTHENTICATE', client.config.saslMechanism)
        client.events.emit('capNegotiated', Array.from(client.state.capabilities))
        // Don't send CAP END yet — SASL handler will do it after auth
        return
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
        if (REQUESTED_CAPS.includes(name as typeof REQUESTED_CAPS[number])) {
          newCaps.push(name)
        }
      }

      if (newCaps.length > 0) {
        requestCapabilities(client, newCaps)
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
 * Ask for capabilities, in as many CAP REQ lines as it takes.
 *
 * A wish list that has grown past the line limit is not a small problem: the
 * server answers `417 ERR_INPUTTOOLONG`, registration never completes, and the
 * client simply never connects. The capability-negotiation spec requires the
 * split, and each CAP REQ is atomic — the server ACKs or NAKs a whole line — so
 * splitting changes nothing except that it fits.
 */
export function requestCapabilities(
  client: {
    connection: { send: (...args: string[]) => void }
    state: { pendingCapRequests: number }
  },
  caps: string[]
): void {
  const budget = MAX_LINE_BYTES - Buffer.byteLength('CAP REQ :') - 2 // CRLF

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
