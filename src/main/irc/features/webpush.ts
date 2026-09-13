import { registerHandler } from '../handlers/registry'

/**
 * draft/webpush — asking the server to push to us when we are not connected.
 *
 * The device gets an endpoint from a push service and gives the server that
 * endpoint plus two keys. The server encrypts each notification to those keys
 * (RFC 8291) and hands it to the service, so the service forwards something it
 * cannot read.
 *
 * The server's VAPID public key is the `VAPID` ISUPPORT token — the device
 * needs it to subscribe with the right application server key, and without
 * it most push services will not accept the subscription. Early drafts put
 * the key in the capability's value instead, so that is still read when the
 * token is missing.
 */

export interface WebPushKeys {
  /** The subscription's public key, base64url, unpadded */
  p256dh: string
  /** The auth secret, base64url, unpadded */
  auth: string
}

/** The server's VAPID key: the ISUPPORT token, else the capability value */
export function vapidKeyFrom(
  isupport: Record<string, string | true>,
  capabilityValue?: string | null
): string | null {
  const advertised = isupport['VAPID']
  if (typeof advertised === 'string' && advertised.length > 0) return advertised

  if (!capabilityValue) return null
  for (const segment of capabilityValue.split(',')) {
    const at = segment.indexOf('=')
    if (at === -1) continue
    if (segment.slice(0, at) === 'vapid') return segment.slice(at + 1) || null
  }
  return null
}

/**
 * Register an endpoint to be pushed to.
 *
 * Servers generally require an account first — a push endpoint is a standing
 * instruction to send somebody your messages, so it belongs to a login rather
 * than to whoever currently holds a nick.
 */
export function registerPushEndpoint(
  client: {
    connection: { send: (...args: string[]) => void }
    state: { capabilities: Set<string> }
  },
  endpoint: string,
  keys: WebPushKeys
): boolean {
  if (!client.state.capabilities.has('draft/webpush')) return false

  client.connection.send(
    'WEBPUSH',
    'REGISTER',
    endpoint,
    `p256dh=${keys.p256dh}`,
    `auth=${keys.auth}`
  )
  return true
}

/** Stop being pushed to — on unpairing, or when the endpoint is replaced */
export function unregisterPushEndpoint(
  client: {
    connection: { send: (...args: string[]) => void }
    state: { capabilities: Set<string> }
  },
  endpoint: string
): boolean {
  if (!client.state.capabilities.has('draft/webpush')) return false

  client.connection.send('WEBPUSH', 'UNREGISTER', endpoint)
  return true
}

/**
 * What the server said about it.
 *
 * Registration is refused far more often than it succeeds — no account, too
 * many endpoints, an endpoint the server will not talk to — and a client that
 * drops the refusal leaves someone waiting for notifications that will never
 * arrive.
 */
registerHandler('WEBPUSH', (client, msg) => {
  client.events.emit('webpush', {
    subcommand: msg.params[0] || '',
    endpoint: msg.params[1] || ''
  })
})
