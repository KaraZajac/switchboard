import { registerHandler } from '../handlers/registry'
import { metadataCapOf } from '@shared/metadata'

import { METADATA_KEYS } from '@shared/types/metadata'

/**
 * draft/metadata-2 and -3 — user metadata (avatar, display name, pronouns, …)
 *
 * Numerics:
 *   761 RPL_KEYVALUE        — <target> <key> <visibility> :<value>
 *   762 RPL_METADATAEND     — end of a GET/LIST response
 *   766 RPL_KEYNOTSET       — the key has no value (treat as cleared)
 *   770 RPL_METADATASUBOK   — keys we are now subscribed to
 *   772 RPL_METADATASUBS    — current subscriptions
 *   774 RPL_METADATASYNCLATER — retry the SYNC later
 *
 * Commands:
 *   METADATA <target> GET <key> [<key> ...]
 *   METADATA <target> SET <key> [:<value>]     (no value clears it)
 *   METADATA * SUB <key> [<key> ...]
 *   METADATA <target> SYNC
 *
 * Subscribing once and then SYNCing a channel is how we learn about everyone
 * else: the server then pushes changes for people we share a channel with,
 * rather than us asking per nick.
 */

/** What the server said it will hold, from the metadata capability's value */
export interface MetadataLimits {
  maxSubs: number | null
  maxKeys: number | null
  maxValueBytes: number | null
}

/**
 * Read the limits out of the capability value.
 *
 * rIRCd advertises `max-subs=50,max-keys=50,max-value-bytes=4096`, and a value
 * over the last of those is refused rather than truncated — so a profile with
 * a long bio in it is not saved anywhere, and until this the user was told it
 * had been.
 */
export function parseMetadataLimits(value: string | null | undefined): MetadataLimits {
  const limits: MetadataLimits = { maxSubs: null, maxKeys: null, maxValueBytes: null }
  if (!value) return limits

  for (const token of value.split(',')) {
    const at = token.indexOf('=')
    if (at === -1) continue

    const key = token.slice(0, at).trim()
    const count = Number(token.slice(at + 1).trim())
    if (!Number.isInteger(count) || count <= 0) continue

    if (key === 'max-subs') limits.maxSubs = count
    if (key === 'max-keys') limits.maxKeys = count
    if (key === 'max-value-bytes') limits.maxValueBytes = count
  }

  return limits
}

/** The limits this connection is under, or none if the server named none */
export function metadataLimitsOf(client: {
  state: {
    availableCapabilities: Map<string, string | null>
    capabilities: Set<string>
  }
}): MetadataLimits {
  // Off whichever version is in force: the two advertise separately and a
  // server may state different numbers for each.
  const cap = metadataCapOf(client.state.capabilities) ?? 'draft/metadata-2'
  return parseMetadataLimits(client.state.availableCapabilities.get(cap))
}

/**
 * Subscribe to the keys we render, and pull what is already set.
 *
 * Trimmed to `max-subs` where the server named one. Asking for more than it
 * will take gets the whole subscription refused, which costs every profile on
 * the network rather than the one key past the limit.
 */
export function subscribeToMetadata(client: {
  connection: { send: (...args: string[]) => void }
  state: { availableCapabilities: Map<string, string | null>; capabilities: Set<string> }
}): void {
  const limits = metadataLimitsOf(client)
  const keys =
    limits.maxSubs === null ? METADATA_KEYS : METADATA_KEYS.slice(0, limits.maxSubs)
  if (keys.length === 0) return

  client.connection.send('METADATA', '*', 'SUB', ...keys)
}

/**
 * Whether a value is short enough for this server to keep.
 *
 * Counted in UTF-8 bytes, which is what the limit is in — a bio in Japanese
 * hits it at a third of the characters an English one does.
 */
export function metadataValueFits(
  client: {
    state: { availableCapabilities: Map<string, string | null>; capabilities: Set<string> }
  },
  value: string
): boolean {
  const limit = metadataLimitsOf(client).maxValueBytes
  return limit === null || Buffer.byteLength(value, 'utf8') <= limit
}

/** Ask for the subscribed metadata of a target and, for a channel, its members. */
export function syncMetadata(
  client: { connection: { send: (...args: string[]) => void } },
  target: string
): void {
  client.connection.send('METADATA', target, 'SYNC')
}

/** Keep the value on the connection so a new client can be handed the whole picture */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function remember(client: any, target: string, key: string, value: string): void {
  const store = client.state.metadata as Map<string, Record<string, string>>
  const mapKey = client.state.casemap(target)
  const current = { ...(store.get(mapKey) ?? {}) }

  if (value === '') {
    delete current[key]
  } else {
    current[key] = value
  }

  if (Object.keys(current).length === 0) {
    store.delete(mapKey)
  } else {
    store.set(mapKey, current)
  }
}

/** Strip leading ':' that may leak from non-standard server implementations */
function cleanValue(val: string): string {
  return val.startsWith(':') ? val.slice(1) : val
}

/**
 * Keys we have just asked to clear, per connection.
 *
 * A server that answers a clear correctly sends 766, or a 761 with no value.
 * At least one sends `761 <me> <me> <key> * <key>` — the key repeated where the
 * value belongs — which is indistinguishable from someone setting their
 * pronouns to the word "pronouns", except that we know we just cleared it.
 * That is what this remembers, and only until the answer arrives.
 */
const clearing = new WeakMap<object, Set<string>>()

/** Note that a clear is in flight, so its echo can be recognised */
export function expectCleared(client: object, key: string): void {
  const pending = clearing.get(client) ?? new Set<string>()
  pending.add(key)
  clearing.set(client, pending)
}

/** Was this the echo of a clear we asked for, rather than a real value? */
function isEchoOfClear(client: object, key: string, value: string): boolean {
  const pending = clearing.get(client)
  if (!pending?.has(key)) return false
  pending.delete(key)
  return value === key || value === ''
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

  // A clear we asked for, answered badly. Recording the key as its own value
  // is how "leave this blank" turns into a profile full of the words
  // "pronouns", "status" and "homepage".
  const cleared = isEchoOfClear(client, key, value)
  const settled = cleared ? '' : value

  remember(client, target, key, settled)
  client.events.emit('metadata', { target, key, value: settled })
})

// RPL_METADATAEND
registerHandler('762', (_client, _msg) => {
  // End of metadata — no action needed
})

// RPL_KEYNOTSET — <me> <target> <key> :key not set
registerHandler('766', (client, msg) => {
  const target = msg.params[1] || ''
  const key = msg.params[2] || ''
  if (!target || !key) return
  // An empty value is how a cleared key reaches the UI
  remember(client, target, key, '')
  client.events.emit('metadata', { target, key, value: '' })
})

// RPL_METADATASUBOK / RPL_METADATASUBS — confirmation only
registerHandler('770', (_client, _msg) => {})
registerHandler('772', (_client, _msg) => {})

// RPL_METADATASYNCLATER — <me> <target> [<retry-after>]
registerHandler('774', (client, msg) => {
  const target = msg.params[1]
  const retryAfter = Number(msg.params[2] || '10')
  if (!target) return
  // The server is rate-limiting us; come back rather than dropping the sync.
  setTimeout(
    () => client.connection.send('METADATA', target, 'SYNC'),
    Math.min(Math.max(retryAfter, 1), 60) * 1000
  )
})

// Incoming METADATA notification from server
registerHandler('METADATA', (client, msg) => {
  // :nick!user@host METADATA <target> <subcommand> <key> [<visibility>] :<value>
  const target = msg.params[0] || ''
  const subcommand = msg.params[1] || ''

  if (subcommand.toUpperCase() === 'SET') {
    const key = msg.params[2] || ''
    if (!key) return

    // "METADATA <target> SET <key>" with no value means the key was cleared
    const value = msg.params.length < 4 ? '' : cleanValue(msg.params[msg.params.length - 1] ?? '')

    remember(client, target, key, value)
    client.events.emit('metadata', { target, key, value })
  }
})
