/** Default IRC port (TLS) */
export const DEFAULT_PORT_TLS = 6697

/** Default IRC port (plaintext) */
export const DEFAULT_PORT = 6667

/** Default nick */
export const DEFAULT_NICK = 'Switchboard'

/** Default username */
export const DEFAULT_USERNAME = 'switchboard'

/** Default realname */
export const DEFAULT_REALNAME = 'Switchboard IRC Client'

/** IRCv3 capabilities we request (in priority order) */
export const REQUESTED_CAPS = [
  'cap-notify',
  'message-tags',
  'batch',
  'labeled-response',
  'echo-message',
  'server-time',
  'message-ids',
  'sasl',
  'multi-prefix',
  'userhost-in-names',
  'extended-join',
  'account-notify',
  'account-tag',
  'away-notify',
  'chghost',
  'setname',
  'invite-notify',
  'bot',
  'standard-replies',
  'draft/chathistory',
  'draft/read-marker',
  'draft/multiline',
  'draft/message-redaction',
  'draft/edit',
  'draft/channel-rename',
  'draft/account-registration',
  'draft/metadata-2',
  'draft/event-playback',
  'draft/no-implicit-names',
  'draft/pre-away',
  'draft/persistence',
  'draft/register-before-connect',
  'draft/search',
  'draft/auto-join',
  '+draft/channel-context',
  '+typing',
  'UTF8ONLY'
] as const

/** Tag escaping map per IRCv3 message-tags spec */
export const TAG_ESCAPE_MAP: Record<string, string> = {
  '\\:': ';',
  '\\s': ' ',
  '\\\\': '\\',
  '\\r': '\r',
  '\\n': '\n'
}

/** Reverse tag escaping map */
export const TAG_UNESCAPE_MAP: Record<string, string> = {
  ';': '\\:',
  ' ': '\\s',
  '\\': '\\\\',
  '\r': '\\r',
  '\n': '\\n'
}

/** Max message tags size (bytes) */
export const MAX_TAGS_SIZE = 8191

/** Max client tags size (bytes) */
export const MAX_CLIENT_TAGS_SIZE = 4094

/** SASL chunk size (bytes) */
export const SASL_CHUNK_SIZE = 400

/** Typing notification throttle (ms) */
export const TYPING_THROTTLE_MS = 3000

/** Typing active timeout (ms) */
export const TYPING_ACTIVE_TIMEOUT_MS = 6000

/** Typing paused timeout (ms) */
export const TYPING_PAUSED_TIMEOUT_MS = 30000

/** IRC channel prefixes — names starting with these are channels, not DMs */
const CHANNEL_PREFIXES = new Set(['#', '&', '!', '+'])

/** Check if a target name is an IRC channel (vs a private message nick) */
export function isChannelName(name: string): boolean {
  return name.length > 0 && CHANNEL_PREFIXES.has(name[0])
}

/** Well-known IRC service nicks — shown in the channel sidebar, not DMs */
export const IRC_SERVICES = new Set(['nickserv', 'chanserv', 'memoserv', 'operserv', 'botserv', 'hostserv', 'saslserv', 'ctcpserv'])

/** Check if a nick is a known IRC service */
export function isServiceNick(name: string): boolean {
  return IRC_SERVICES.has(name.toLowerCase())
}
