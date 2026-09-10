import data from './networks.json'

/**
 * Networks to offer somebody who has none.
 *
 * IRC's worst moment is the first one: a client that opens on an empty screen
 * and a box wanting a hostname is asking a question most people cannot answer,
 * and the answer is not discoverable from inside the app. This is a starting
 * point, not a directory — anything can still be typed in by hand.
 *
 * The list itself is `networks.json`, which both clients read: the desktop
 * imports it, and the Android build copies it into the app's assets. One file,
 * so the two cannot come to disagree about where Libera is.
 */
export interface KnownNetwork {
  id: string
  name: string
  host: string
  port: number
  tls: boolean
  /** One line on what the network is for */
  description: string
  /** Roughly where its servers are */
  region: string
  homepage?: string
  /** Somewhere to land, so the first screen is not empty either */
  channels?: string[]
  /** What answered when this entry was last checked, and any caveat */
  checked?: string
}

export const KNOWN_NETWORKS: KnownNetwork[] = data.networks

/** When the list was last confirmed by connecting to each of them */
export const NETWORKS_CHECKED_AT: string = data.checkedAt

/**
 * The ones worth showing first.
 *
 * Ordered as written rather than sorted: the file is in rough size order, and
 * "the biggest one for what you are here for" is more useful than alphabetical
 * to somebody who does not yet know any of these names.
 */
export function suggestedNetworks(query = ''): KnownNetwork[] {
  const wanted = query.trim().toLowerCase()
  if (!wanted) return KNOWN_NETWORKS

  return KNOWN_NETWORKS.filter(
    (network) =>
      network.name.toLowerCase().includes(wanted) ||
      network.description.toLowerCase().includes(wanted) ||
      network.region.toLowerCase().includes(wanted) ||
      network.host.toLowerCase().includes(wanted)
  )
}
