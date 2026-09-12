import { METADATA_KEYS } from './types/metadata'

/**
 * Which metadata extension a connection negotiated.
 *
 * There are two live versions of the draft and servers advertise both.
 * `draft/metadata-3` is the newer one: it pushes changes as numerics — 761 and
 * 766 — where `draft/metadata-2` pushes a `METADATA` command, and it allows a
 * client to set its own keys during registration rather than waiting for 001.
 *
 * Only `metadata-2` is in the IRCv3 registry; `metadata-3` is a name rIRCd
 * uses for the updated spec. Both are handled because both are advertised by
 * a server we actually talk to, and the two shapes cost nothing to accept —
 * the numerics were already handled as live updates.
 *
 * Newest first: where a server offers both, that is the one to read limits
 * from and the one whose behaviour applies.
 */
export const METADATA_CAPS = ['draft/metadata-3', 'draft/metadata-2'] as const

type Negotiated = Iterable<string> | { has(value: string): boolean }

function negotiated(caps: Negotiated): (name: string) => boolean {
  if (typeof (caps as { has?: unknown }).has === 'function') {
    return (name) => (caps as { has(value: string): boolean }).has(name)
  }
  const set = new Set(caps as Iterable<string>)
  return (name) => set.has(name)
}

/** Whether this connection can do metadata at all, by either version */
export function hasMetadata(caps: Negotiated): boolean {
  const held = negotiated(caps)
  return METADATA_CAPS.some(held)
}

/**
 * The metadata capability actually in force, or null.
 *
 * Which one matters for reading the limits off its value: the two advertise
 * separately and a server may state different numbers for each.
 */
export function metadataCapOf(caps: Negotiated): string | null {
  const held = negotiated(caps)
  return METADATA_CAPS.find(held) ?? null
}

/**
 * The most of a metadata value we will keep.
 *
 * A value is a string a stranger chose, and what a server *advertises* as its
 * limit is not a promise — `max-value-bytes=400` is what rIRCd says it will
 * accept, not what it will refuse to forward. Nothing checked on the way in,
 * so a display name could be a megabyte, and a display name is drawn beside
 * every line somebody says.
 *
 * Generous against every real limit, small against anything meant as a weapon.
 * Counted in characters rather than bytes so that both clients cut in exactly
 * the same place.
 */
export const MAX_METADATA_VALUE = 512

/**
 * What to store for a metadata update, or null to ignore it.
 *
 * Two rules. Only the keys we actually render: we subscribe to those six and
 * nothing else is ever drawn, so keeping the rest is a map that grows with
 * whatever a server feels like sending and is read by nobody. And a ceiling on
 * the value, for the reason above.
 *
 * An empty value is kept rather than dropped — that is a key being cleared,
 * which is a change worth having.
 */
export function metadataToKeep(key: string, value: string): { key: string; value: string } | null {
  const name = key.trim().toLowerCase()
  if (!(METADATA_KEYS as readonly string[]).includes(name)) return null

  return {
    key: name,
    value: value.length > MAX_METADATA_VALUE ? value.slice(0, MAX_METADATA_VALUE) : value
  }
}
