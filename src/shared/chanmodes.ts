/**
 * What a channel is set to, in words.
 *
 * `CHANMODES` has been parsed since the beginning — the permissions code reads
 * it, the mask lists read it — and there has never been anywhere to *see* a
 * channel's settings, let alone change one. The only way to make a channel
 * invite-only was `/mode #channel +i`, which means knowing that `i` is the
 * letter.
 *
 * Which letters a network has is its own answer, from ISUPPORT. What they mean
 * is convention, and that part is here: the dozen every ircd agrees on, and a
 * plain `+x` for anything else, because a network that invented a mode did so
 * for a reason and hiding it would be worse than naming it badly.
 */

export type ModeKind =
  /** Takes a mask and accumulates — bans and the like. Not settings. */
  | 'list'
  /** Always takes a parameter, setting and unsetting */
  | 'param'
  /** Takes one only when set */
  | 'paramOnSet'
  /** On or off */
  | 'flag'

export interface ChannelMode {
  letter: string
  kind: ModeKind
  /** What to call it */
  label: string
  /** What it does, in one line */
  hint: string
  /** What to call the value, where it takes one */
  placeholder?: string
}

/**
 * The ones every ircd means the same thing by.
 *
 * Not exhaustive on purpose: a letter here is one where being wrong would be
 * worse than saying nothing, so anything a network is free to redefine stays
 * out and is shown as itself.
 */
const KNOWN: Record<string, Omit<ChannelMode, 'letter' | 'kind'>> = {
  i: { label: 'Invite only', hint: 'Nobody can join without an invitation.' },
  m: { label: 'Moderated', hint: 'Only voiced people and operators can speak.' },
  n: {
    label: 'No outside messages',
    hint: 'Only people in the channel can send to it.'
  },
  p: { label: 'Private', hint: 'Hidden from the channel list.' },
  s: { label: 'Secret', hint: 'Hidden from the channel list and from WHOIS.' },
  t: { label: 'Topic locked', hint: 'Only operators can change the topic.' },
  k: {
    label: 'Password',
    hint: 'Everyone joining has to know it.',
    placeholder: 'Channel password'
  },
  l: {
    label: 'Limit',
    hint: 'How many people may be here at once.',
    placeholder: 'Number of people'
  }
}

/**
 * Which modes this network has, and what each one is.
 *
 * List modes are left out: they are not settings but collections, and they have
 * a panel of their own — see `@shared/masklists`.
 */
export function channelModesFor(
  chanmodes: string | undefined | null,
  prefix: string | undefined | null
): ChannelMode[] {
  const [typeA = '', typeB = '', typeC = '', typeD = ''] = (chanmodes || '').split(',')
  const ranks = new Set(readPrefixModes(prefix))

  const modes: ChannelMode[] = []
  const add = (letters: string, kind: ModeKind): void => {
    for (const letter of letters) {
      // A letter that is also a rank is not a channel setting
      if (ranks.has(letter)) continue
      const known = KNOWN[letter]
      modes.push(
        known
          ? { letter, kind, ...known }
          : {
              letter,
              kind,
              label: `+${letter}`,
              hint: `A mode this network calls +${letter}.`,
              placeholder: kind === 'flag' ? undefined : 'Value'
            }
      )
    }
  }

  // Type A is the mask lists, which are not settings
  void typeA
  add(typeB, 'param')
  add(typeC, 'paramOnSet')
  add(typeD, 'flag')

  return modes
}

/**
 * The MODE change for turning one setting on or off.
 *
 * Returns the arguments to `MODE <channel> ...`, or null when there is nothing
 * to send — turning a limit on with no number, for instance, which the server
 * would answer with an error about a command we chose to send.
 */
export function modeChange(
  mode: ChannelMode,
  on: boolean,
  value: string | null | undefined
): string[] | null {
  const sign = on ? '+' : '-'

  if (mode.kind === 'flag') return [`${sign}${mode.letter}`]

  if (!on) {
    // Unsetting a key needs the key on most servers, and giving it where it is
    // not needed is harmless — leaving it out where it is needed is not.
    return mode.kind === 'param' && value ? [`-${mode.letter}`, value] : [`-${mode.letter}`]
  }

  const wanted = (value ?? '').trim()
  if (wanted.length === 0) return null
  return [`+${mode.letter}`, wanted]
}

/** The prefix letters, so a rank is never offered as a setting */
function readPrefixModes(prefix: string | undefined | null): string {
  const match = /^\(([^)]*)\)/.exec(prefix || '')
  return match ? match[1] : ''
}
