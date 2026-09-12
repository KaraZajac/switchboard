/**
 * Which settings belong to the person rather than to the machine.
 *
 * Two very different things need the same answer, which is why the list lives
 * here rather than beside either of them:
 *
 *  - the vault, deciding what to carry between devices, and
 *  - the remote link, deciding what a paired device may read or write.
 *
 * The theme is the obvious one — the two clients share it deliberately. Mutes
 * are the same kind of thing: a conversation you have silenced is silenced
 * because of what it is, not because of which device you silenced it on. And
 * the profile most of all: a display name and a set of pronouns are facts
 * about the person, not about the machine they were typed on.
 *
 * What is *not* here matters just as much. A proxy address carries a username
 * and a password for this machine; a CA path describes this disk. Neither
 * should be copied onto a phone, and neither should be readable by one.
 *
 * This list is also what survives a reseal: the vault rebuilds its settings
 * object from it, so a key the other device wrote and this one has never heard
 * of is dropped.
 */
export const SHARED_SETTINGS = [
  'theme',
  'mutes',
  'profile',
  'ignores',
  'highlights',
  'aliases',
  // How long of nothing counts as away is a fact about the person, not about
  // the device measuring it — and the two measure it differently, so having
  // two settings would mean the phone and the desktop disagreeing about when
  // you left.
  'autoAwayMinutes',
  'autoAwayMessage'
] as const

export type SharedSetting = (typeof SHARED_SETTINGS)[number]

/** Whether a paired device may read or write this setting at all */
export function isSharedSetting(key: unknown): boolean {
  return typeof key === 'string' && (SHARED_SETTINGS as readonly string[]).includes(key)
}
