import { registerHandler } from '../handlers/registry'

/**
 * labeled-response — Correlate client requests with server responses.
 *
 * Client sends: @label=abc123 PRIVMSG #channel :hello
 * Server responds: @label=abc123 :server ACK
 *   OR wraps multi-message response in a labeled-response batch.
 *
 * ACK is sent for commands that normally produce no reply.
 */

registerHandler('ACK', (client, msg) => {
  const label = typeof msg.tags['label'] === 'string' ? msg.tags['label'] : null
  if (label) {
    client.events.emit('labeledAck', { label })
  }
})
