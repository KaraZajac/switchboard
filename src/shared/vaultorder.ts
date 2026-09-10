/**
 * Which of two sealed configs is the one to keep.
 *
 * Version first, because that is what stops a rollback: an older vault may
 * carry a password somebody already has, and adopting it would put it back.
 *
 * Then the timestamp, for the case version alone cannot settle — both devices
 * edit while unable to see each other, both seal the next version, and each
 * refuses the other's as "not newer". Without a tiebreak they stay that way
 * until somebody edits again, which is a strange thing to ask of a user who
 * has no idea anything is wrong. The later edit wins; that is what a person
 * means by "the newer one".
 *
 * A tie on both is the same config as far as anything here can tell, and
 * refusing is the stable answer — adopting would have two devices swapping
 * identical vaults forever.
 */
export function shouldAdoptVault(
  incoming: { version: number; updatedAt?: string | null },
  current: { version: number; updatedAt?: string | null } | null
): boolean {
  if (!current) return true
  if (incoming.version > current.version) return true
  if (incoming.version < current.version) return false

  // ISO-8601 in UTC sorts correctly as text, which is what both clients write.
  // A missing timestamp cannot be compared, and guessing is worse than leaving
  // the two devices to settle it with the next real edit.
  const theirs = incoming.updatedAt
  const ours = current.updatedAt
  if (!theirs || !ours) return false

  return theirs > ours
}
