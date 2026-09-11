/**
 * The lists a channel keeps: bans, quiets, exceptions, invites.
 *
 * We ship a ban action and had nowhere to see what is banned. You could put
 * somebody on a list and never find them again — not to lift it, not to check
 * whether the mask you guessed at actually matched, not to see what the last
 * operator did. Half a feature, and the wrong half.
 *
 * These are the CHANMODES type A modes: the ones that take a mask and
 * accumulate rather than being set or unset. Which letters exist is a property
 * of the network and comes from ISUPPORT; what they *mean* is convention, and
 * that part is here. A letter nobody has heard of still gets a list, named
 * after itself, because a network that invented a mode did so for a reason.
 */

import { parsePrefix } from './powers'

export interface MaskList {
  /** The mode letter, as used in `MODE #channel +b` */
  mode: string
  /** What to call the list */
  label: string
  /** What being on it does, in one line */
  hint: string
  /** What one entry is called, for "Lift this ban" */
  entry: string
}

/**
 * The four every network means the same thing by.
 *
 * `q` is deliberately absent: on Unreal and InspIRCd it is a prefix meaning
 * channel owner, and only a list mode elsewhere. [maskListsFor] settles that
 * the same way `quietMode` does, by asking whether the letter is a prefix.
 */
const KNOWN: Record<string, Omit<MaskList, 'mode'>> = {
  b: {
    label: 'Bans',
    hint: 'Anyone matching cannot join, and is removed if they are here.',
    entry: 'ban'
  },
  q: {
    label: 'Quiets',
    hint: 'Anyone matching can be here but cannot speak.',
    entry: 'quiet'
  },
  e: {
    label: 'Ban exceptions',
    hint: 'Anyone matching may join even if a ban would have stopped them.',
    entry: 'exception'
  },
  I: {
    label: 'Invite exceptions',
    hint: 'Anyone matching may join an invite-only channel without an invite.',
    entry: 'invite exception'
  }
}

/**
 * The lists this network actually keeps.
 *
 * Read off CHANMODES rather than assumed: a network without `+e` should not be
 * offered a tab for it that will only ever be empty, and one with a mode we
 * have never seen should not have it hidden.
 */
export function maskListsFor(
  chanmodes: string | undefined | null,
  prefix: string | undefined | null
): MaskList[] {
  const typeA = (chanmodes || '').split(',')[0] || ''
  const scheme = parsePrefix(prefix)

  const lists: MaskList[] = []
  for (const mode of typeA) {
    // A letter that is also a prefix is a rank, not a list — `q` is owner on
    // Unreal and quiet on Solanum, and the two must not be confused.
    if (scheme.modes.includes(mode)) continue

    const known = KNOWN[mode]
    lists.push(
      known
        ? { mode, ...known }
        : {
            mode,
            label: `+${mode} list`,
            hint: `A list this network keeps under mode +${mode}.`,
            entry: `+${mode} entry`
          }
    )
  }
  return lists
}

/** One entry on one of those lists */
export interface MaskEntry {
  /** The mask itself, e.g. `*!*@example.org` */
  mask: string
  /** Who put it there, where the server says */
  setBy?: string
  /** When, in seconds since the epoch, where the server says */
  setAt?: number
}

export interface ListReply {
  /** Which list this line is part of */
  mode: string
  channel: string
  /** Absent on an end-of-list numeric */
  entry?: MaskEntry
  /** Whether this numeric closes the list */
  done: boolean
}

/**
 * Which numerics carry which list.
 *
 * The odd one out is 728: unlike the rest it names its own mode in a
 * parameter, because it was added for networks that have more than one
 * mask list beyond bans. So the mode cannot simply be read off the numeric.
 */
const LIST_NUMERICS: Record<string, { mode: string | 'in-params'; done: boolean }> = {
  '367': { mode: 'b', done: false },
  '368': { mode: 'b', done: true },
  '346': { mode: 'I', done: false },
  '347': { mode: 'I', done: true },
  '348': { mode: 'e', done: false },
  '349': { mode: 'e', done: true },
  '728': { mode: 'in-params', done: false },
  '729': { mode: 'in-params', done: true }
}

/** Whether this numeric is part of a mask list at all */
export function isListNumeric(command: string): boolean {
  return command in LIST_NUMERICS
}

/**
 * Read one line of a list.
 *
 * The shapes differ more than they look. RPL_BANLIST is
 * `<me> <channel> <mask> [<who> <when>]` — the last two optional, and absent
 * on plenty of servers. RPL_QUIETLIST is `<me> <channel> <mode> <mask> ...`,
 * one parameter longer. Reading the second as the first puts the mode letter
 * in the list as though somebody had banned the letter `q`.
 */
export function readListReply(command: string, params: string[]): ListReply | null {
  const shape = LIST_NUMERICS[command]
  if (!shape) return null

  const channel = params[1] || ''
  if (!channel) return null

  // 728/729 carry the mode as a parameter; everything else is implied
  const modeFromParams = params[2] || ''
  const mode = shape.mode === 'in-params' ? modeFromParams : shape.mode
  if (!mode) return null

  if (shape.done) return { mode, channel, done: true }

  const at = shape.mode === 'in-params' ? 3 : 2
  const mask = params[at] || ''
  if (!mask) return null

  const setBy = params[at + 1] || undefined
  const stamp = Number(params[at + 2])
  const setAt = Number.isFinite(stamp) && stamp > 0 ? stamp : undefined

  return { mode, channel, done: false, entry: { mask, setBy, setAt } }
}

/**
 * Whether this looks like a mask rather than a bare nick.
 *
 * `MODE #chan +b kara` is legal and most servers expand it to `kara!*@*`, but
 * some do not — and a list full of bare words is a list nobody can read. Used
 * to offer to expand what somebody typed, not to refuse it.
 */
export function looksLikeMask(value: string): boolean {
  return value.includes('!') || value.includes('@') || value.includes('*')
}

/**
 * What to actually send for something typed into a ban box.
 *
 * A bare nick becomes `nick!*@*`, which is what almost every server would have
 * done anyway and what the person plainly meant. Anything with mask punctuation
 * in it is left exactly as typed — guessing at a half-written mask would be
 * worse than sending it.
 */
export function maskToSet(typed: string): string {
  const value = typed.trim()
  if (value.length === 0) return ''
  if (looksLikeMask(value)) return value
  return `${value}!*@*`
}
