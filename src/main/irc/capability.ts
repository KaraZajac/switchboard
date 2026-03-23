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
            // The client manager should handle reconnecting with TLS
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
        client.connection.send('CAP', 'REQ', toRequest.join(' '))
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
      // Server rejected our cap request
      // Try to continue without the rejected caps
      // We could retry with a subset, but for simplicity just end negotiation
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
        client.connection.send('CAP', 'REQ', newCaps.join(' '))
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
