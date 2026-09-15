import { randomUUID } from 'crypto'
import type { ServerConfig } from '@shared/types/server'
import { addServer, getServer, removeServer, updateServer } from '../storage/models/server'
import { parseAddress } from '@shared/addresses'
import { ircManager } from '../irc/manager'
import { DEFAULT_NICK } from '@shared/constants'

/**
 * Adding and changing networks from an attached IRC client.
 *
 * `soju.im/bouncer-networks` is how a client manages a bouncer's networks
 * without leaving IRC — the same extension Switchboard's own clients use when
 * they are talking to a soju. Supporting both ends of it means a headless
 * Switchboard is configurable from anything that speaks it, and that somebody
 * who has never opened the desktop app can still set one up.
 *
 * The attribute names are soju's, because a client that knows how to configure
 * a bouncer already knows them.
 */

/** Build a network from the attributes a client sent, over whatever exists */
export function networkFromAttributes(
  attributes: Map<string, string | null>,
  existing: ServerConfig | null
): { config: ServerConfig; error: string | null } {
  const base: ServerConfig = existing ?? {
    id: randomUUID(),
    name: '',
    host: '',
    port: 6697,
    tls: true,
    password: null,
    nick: DEFAULT_NICK,
    username: '',
    realname: '',
    saslMechanism: null,
    saslUsername: null,
    saslPassword: null,
    autoConnect: true,
    autoJoin: [],
    identifyCommand: null,
    performOnConnect: null,
    sortOrder: 0,
    websocketUrl: null,
    avatarUrl: null,
    profile: {},
    preAwayMessage: null,
    clientCert: null
  }

  const config: ServerConfig = { ...base }

  for (const [key, value] of attributes) {
    // No `=` means remove, which for us means back to the default
    switch (key) {
      case 'host': {
        if (value === null) break
        // `host`, `host:6667` or `host:+6697` — a client is allowed to put the
        // port here, and several do
        const parsed = parseAddress(value, { port: config.port, tls: config.tls })
        if (parsed) {
          config.host = parsed.host
          config.port = parsed.port
          config.tls = parsed.tls
        }
        break
      }
      case 'port': {
        const port = Number(value)
        if (Number.isInteger(port) && port > 0 && port < 65536) config.port = port
        break
      }
      case 'tls':
        config.tls = value !== '0' && value !== null
        break
      case 'name':
        config.name = value ?? ''
        break
      case 'nickname':
        config.nick = value ?? DEFAULT_NICK
        break
      case 'username':
        config.username = value ?? ''
        break
      case 'realname':
        config.realname = value ?? ''
        break
      case 'pass':
        config.password = value
        break
      case 'sasl':
        // `sasl=plain` with sasl-username and sasl-password beside it
        config.saslMechanism =
          value === null ? null : (value.toUpperCase() as ServerConfig['saslMechanism'])
        break
      case 'sasl-username':
        config.saslUsername = value
        break
      case 'sasl-password':
        config.saslPassword = value
        break
      case 'enabled':
        config.autoConnect = value !== '0'
        break
    }
  }

  if (!config.host) return { config, error: 'A network needs a host' }
  if (!config.name) config.name = config.host
  if (!config.username) config.username = config.nick
  if (!config.realname) config.realname = config.nick

  return { config, error: null }
}

export function createNetwork(attributes: Map<string, string | null>): {
  id: string | null
  error: string | null
} {
  const { config, error } = networkFromAttributes(attributes, null)
  if (error) return { id: null, error }

  /*
   * The id the row was given, not the one we brought.
   *
   * `addServer` mints its own and returns it. Connecting with the id from the
   * draft config left the live client keyed under an id no row had — so the
   * network was connected and the bouncer could not find it, and an attaching
   * client got a welcome with no nick, no ISUPPORT and no channels.
   */
  const id = addServer(config)
  const stored = { ...config, id }

  if (stored.autoConnect) ircManager.connect(stored)
  return { id, error: null }
}

export function changeNetwork(
  id: string,
  attributes: Map<string, string | null>
): { error: string | null } {
  const existing = getServer(id)
  if (!existing) return { error: 'No such network' }

  const { config, error } = networkFromAttributes(attributes, existing)
  if (error) return { error }

  updateServer(id, config)

  /*
   * A changed address is a changed connection.
   *
   * Writing the row and leaving the socket alone means the client is told the
   * change took while the bouncer is still talking to the old host — and the
   * difference only shows up on the next restart, by which time nobody
   * remembers changing anything.
   */
  const moved =
    existing.host !== config.host || existing.port !== config.port || existing.tls !== config.tls
  if (moved && ircManager.getClient(id)) {
    ircManager.disconnect(id)
    if (config.autoConnect) setTimeout(() => ircManager.connect(config), 1_000)
  }

  return { error: null }
}

export function deleteNetwork(id: string): { error: string | null } {
  if (!getServer(id)) return { error: 'No such network' }
  ircManager.disconnect(id)
  removeServer(id)
  return { error: null }
}
