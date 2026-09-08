/**
 * User metadata (IRCv3 draft/metadata-2).
 *
 * The keys below are the ones in the IRCv3 registry that describe a person
 * rather than a client. They travel per network, not per account: the same
 * person can be `@kara` with one avatar here and another somewhere else.
 */

export const METADATA_KEYS = [
  'avatar',
  'display-name',
  'homepage',
  'pronouns',
  'status',
  'color'
] as const

export type MetadataKey = (typeof METADATA_KEYS)[number]

export type UserMetadata = Partial<Record<MetadataKey, string>>

/** Labels and hints for the profile editor */
export const METADATA_FIELDS: {
  key: MetadataKey
  label: string
  placeholder: string
  hint?: string
}[] = [
  {
    key: 'display-name',
    label: 'Display name',
    placeholder: 'Kara',
    hint: 'Shown instead of your nick'
  },
  { key: 'avatar', label: 'Avatar URL', placeholder: 'https://example.com/avatar.png' },
  { key: 'pronouns', label: 'Pronouns', placeholder: 'they/them' },
  { key: 'status', label: 'Status', placeholder: 'building an IRC client' },
  { key: 'homepage', label: 'Homepage', placeholder: 'https://example.com' },
  {
    key: 'color',
    label: 'Colour',
    placeholder: '#89b4fa',
    hint: 'Used for your name in chat'
  }
]

/** Key names the spec allows: a-z, 0-9 and _ . / - */
export function isValidMetadataKey(key: string): boolean {
  return /^[a-z0-9_./-]+$/.test(key)
}

/**
 * A CSS colour from the `color` key, or null when it is unusable.
 *
 * The registry does not pin a format, so accept what people actually write:
 * `#rgb`, `#rrggbb`, and the mIRC colour numbers 0-15 that IRC users reach for.
 */
export function metadataColor(value: string | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim()

  if (/^#[0-9a-f]{3}$/i.test(trimmed) || /^#[0-9a-f]{6}$/i.test(trimmed)) return trimmed

  const ircIndex = Number(trimmed)
  if (Number.isInteger(ircIndex) && ircIndex >= 0 && ircIndex <= 15) {
    return MIRC_COLORS[ircIndex]
  }

  return null
}

/** The classic 16 mIRC colours, so a `color` of "4" means what an IRC user expects */
const MIRC_COLORS = [
  '#ffffff',
  '#000000',
  '#00007f',
  '#009300',
  '#ff0000',
  '#7f0000',
  '#9c009c',
  '#fc7f00',
  '#ffff00',
  '#00fc00',
  '#009393',
  '#00ffff',
  '#0000fc',
  '#ff00ff',
  '#7f7f7f',
  '#d2d2d2'
]

/** The name to show for someone: their display name if they set one */
export function displayNameFor(nick: string, metadata: UserMetadata | undefined): string {
  const name = metadata?.['display-name']?.trim()
  return name && name.length > 0 ? name : nick
}
