import { registerHandler } from '../handlers/registry'

/**
 * draft/read-marker — Sync read position across devices.
 *
 * Client sends: MARKREAD <target> [timestamp=<ISO8601>]
 * Server sends: MARKREAD <target> timestamp=<ISO8601>
 */

registerHandler('MARKREAD', (client, msg) => {
  const target = msg.params[0]
  let timestamp: string | null = null

  // Parse timestamp= from params
  for (let i = 1; i < msg.params.length; i++) {
    if (msg.params[i].startsWith('timestamp=')) {
      timestamp = msg.params[i].slice('timestamp='.length)
    }
  }

  if (target && timestamp) {
    client.events.emit('readMarker', { channel: target, timestamp })
  }
})
