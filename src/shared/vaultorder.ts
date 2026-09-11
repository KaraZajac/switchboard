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
 *
 * Before any of that: a config nobody chose is not one to defend. A phone
 * makes itself one on first launch, so that adding a server is not gated on
 * owning a desktop — and that placeholder used to win the tiebreak against a
 * desktop's real config, because a phone is always set up after the desktop it
 * pairs to. Pairing succeeded, following worked, and the config silently never
 * arrived; the one thing the vault exists for — the phone being able to take
 * over when the desktop stops — was dead and nothing said so.
 *
 * The flag describes the device asking and never the one offering. The
 * envelope's visible fields are authenticated, so a claim carried there would
 * mean a format change — and a peer's claim about itself is the wrong thing to
 * weigh in any case. A device holding a placeholder simply does not offer it.
 */
export function shouldAdoptVault(
  incoming: { version: number; updatedAt?: string | null },
  current: { version: number; updatedAt?: string | null } | null,
  currentIsPlaceholder = false
): boolean {
  if (currentIsPlaceholder) return true
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
