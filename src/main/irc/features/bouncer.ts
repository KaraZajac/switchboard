import { registerHandler } from '../handlers/registry'
import { parseAttributes, networkFrom, isRemoval, type BouncerNetwork } from '@shared/bouncer'

/**
 * The networks a bouncer holds on our behalf.
 *
 * `soju.im/bouncer-networks` is how a bouncer says what is behind it. One
 * connection reaches one of them — bound by `BOUNCER BIND` during registration
 * — so a person with three networks behind a soju wants three Switchboard
 * networks, each bound to one.
 *
 * Reading the list is the first half of that, and the half that makes the
 * second possible: without it somebody has to know a network id, which on soju
 * is a number nothing in the interface has ever shown them.
 *
 * Kept per connection, updated in place, because
 * `soju.im/bouncer-networks-notify` sends changes one line at a time rather
 * than resending the list.
 */
registerHandler('BOUNCER', (client, msg) => {
  if ((msg.params[0] ?? '').toUpperCase() !== 'NETWORK') return

  const id = msg.params[1]
  if (!id) return

  const attributes = parseAttributes(msg.params[2] ?? '')

  if (isRemoval(attributes)) {
    if (client.state.bouncerNetworks.delete(id)) {
      client.events.emit('bouncerNetworks', {
        networks: [...client.state.bouncerNetworks.values()]
      })
    }
    return
  }

  const previous = client.state.bouncerNetworks.get(id) ?? null
  const network: BouncerNetwork = networkFrom(id, attributes, previous)
  client.state.bouncerNetworks.set(id, network)

  client.events.emit('bouncerNetworks', { networks: [...client.state.bouncerNetworks.values()] })
})
