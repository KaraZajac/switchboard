/**
 * One profile for you, and a different one where you want it.
 *
 * IRC has no global anything: `draft/metadata-2` is per network, and a server
 * only knows what you told *it*. So "global" is the client's own idea, kept in
 * the vault where both devices can see it, and published to each network on
 * connect.
 *
 * What was here before was neither one thing nor the other. Adding a network
 * copied the default into it, and editing a profile anywhere wrote the default
 * *and* that network's copy. So changing your name updated the network you
 * happened to be looking at and left every other one on a frozen copy, and
 * there was no way to be called something different in one place without
 * changing what you are called everywhere.
 *
 * Now: a network with no profile of its own uses yours. One with a profile of
 * its own uses that, field by field — set a display name for a network and
 * only the name changes there; your pronouns and picture still come from the
 * one profile you keep.
 */

import type { UserMetadata } from './types/metadata'

/**
 * What to publish to one network.
 *
 * An override merges over the global rather than replacing it, which is what
 * lets "call me something else here" not also mean "and forget everything else
 * about me". An empty value in an override is a deliberate blank: it clears
 * that field for this network only, which is the only way to have something
 * everywhere except one place.
 */
export function resolveProfile(
  global: UserMetadata | null | undefined,
  override: UserMetadata | null | undefined
): UserMetadata {
  const merged: UserMetadata = { ...(global ?? {}) }
  for (const [key, value] of Object.entries(override ?? {})) {
    const trimmed = (value ?? '').trim()
    if (trimmed.length === 0) delete merged[key as keyof UserMetadata]
    else merged[key as keyof UserMetadata] = trimmed
  }
  return merged
}

/** Whether this network has been given a profile of its own */
export function hasOverride(override: UserMetadata | null | undefined): boolean {
  return Object.keys(override ?? {}).length > 0
}

/**
 * Whether two profiles say the same thing.
 *
 * Used to tell a network that was *seeded* from the global — which is what
 * adding one used to do — from one somebody deliberately made different. A
 * seeded copy is not a choice, and treating it as one would leave every
 * network anyone already had frozen against a global they can no longer
 * change.
 */
export function sameProfile(
  a: UserMetadata | null | undefined,
  b: UserMetadata | null | undefined
): boolean {
  const left = Object.entries(a ?? {}).filter(([, v]) => (v ?? '').trim().length > 0)
  const right = Object.entries(b ?? {}).filter(([, v]) => (v ?? '').trim().length > 0)
  if (left.length !== right.length) return false
  const other = new Map(right.map(([k, v]) => [k, (v ?? '').trim()]))
  return left.every(([k, v]) => other.get(k) === (v ?? '').trim())
}

/**
 * What an override should be stored as, given what was typed against a network.
 *
 * Anything identical to the global is not an override at all, and storing it as
 * one is how a network stops following your profile without anybody asking for
 * that. Returns null for "this network just uses yours".
 */
export function overrideFrom(
  global: UserMetadata | null | undefined,
  typed: UserMetadata | null | undefined
): UserMetadata | null {
  if (!typed) return null
  const kept: UserMetadata = {}
  for (const [key, value] of Object.entries(typed)) {
    const trimmed = (value ?? '').trim()
    const theirs = ((global ?? {})[key as keyof UserMetadata] ?? '').trim()
    // Same as the global is not a difference; blank where the global has
    // something is a deliberate one.
    if (trimmed === theirs) continue
    kept[key as keyof UserMetadata] = trimmed
  }
  return Object.keys(kept).length > 0 ? kept : null
}

/**
 * Which fields this network is still wearing that we no longer say.
 *
 * Clearing a field has to be published, not just stopped being sent: a `SET`
 * with no value is how `draft/metadata-2` deletes one, and without it deleting
 * your display name left every network still calling you by it until something
 * reconnected — and on a server that keeps metadata between sessions, for good.
 *
 * @param keys the fields we manage, so a key the network set on us itself is
 *   left alone rather than deleted by a client that did not put it there
 * @param published what we last put up here, as this connection remembers it
 * @param next what the resolved profile says now
 */
export function keysToClear(
  keys: readonly string[],
  published: Record<string, string | undefined> | null | undefined,
  next: Record<string, string | undefined> | null | undefined
): string[] {
  return keys.filter(
    (key) =>
      ((published ?? {})[key] ?? '').trim().length > 0 &&
      ((next ?? {})[key] ?? '').trim().length === 0
  )
}
