import { registerHandler } from '../handlers/registry'

/**
 * draft/metadata-2 — Handle user metadata (avatar, etc.)
 *
 * Numerics:
 *   761 RPL_KEYVALUE   — <target> <key> <visibility> :<value>
 *   762 RPL_METADATAEND — End of metadata response
 *   766 ERR_NOMATCHINGKEY — No matching key
 *
 * Commands:
 *   METADATA <target> SET <key> :<value>
 *   METADATA <target> GET <key> [<key> ...]
 *
 * Notifications:
 *   METADATA <target> SET <key> <visibility> :<value>
 */

/** Strip leading ':' that may leak from non-standard server implementations */
function cleanValue(val: string): string {
  return val.startsWith(':') ? val.slice(1) : val
}

// RPL_KEYVALUE — metadata key-value pair
registerHandler('761', (client, msg) => {
  // :server 761 <mynick> <target> <key> [<visibility>] :<value>
  // Params layout varies by implementation:
  //   5 params: [mynick, target, key, visibility, value]
  //   4 params: [mynick, target, key, value]
  const target = msg.params[1] || ''
  const key = msg.params[2] || ''
  // The value is always the last param
  const rawValue = msg.params[msg.params.length - 1] ?? ''
  // Skip if the "value" is actually the key (only 3 params = no value)
  if (msg.params.length < 4) return
  const value = cleanValue(rawValue)

  client.events.emit('metadata', { target, key, value })
})

// RPL_METADATAEND
registerHandler('762', (_client, _msg) => {
  // End of metadata — no action needed
})

// ERR_NOMATCHINGKEY
registerHandler('766', (_client, _msg) => {
  // No matching metadata key — silently ignore
})

// Incoming METADATA notification from server
registerHandler('METADATA', (client, msg) => {
  // :nick!user@host METADATA <target> <subcommand> <key> [<visibility>] :<value>
  const target = msg.params[0] || ''
  const subcommand = msg.params[1] || ''

  if (subcommand.toUpperCase() === 'SET') {
    const key = msg.params[2] || ''
    // Value is always the last param
    const rawValue = msg.params[msg.params.length - 1] ?? ''
    if (msg.params.length < 4) return
    const value = cleanValue(rawValue)

    client.events.emit('metadata', { target, key, value })
  }
})
