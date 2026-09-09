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

/**
 * IRCv3 capabilities we ask for, in priority order.
 *
 * Only the ones the server advertises are actually requested, so a name that no
 * server uses is not an error — it is worse than that, it is silent: the
 * feature simply never turns on and nothing says why. Every entry here is the
 * name as registered at ircv3.net/registry.html, checked against the spec.
 *
 * Client *tags* (`+typing`, `+react`, `+draft/channel-context`) are deliberately
 * absent: a tag is never negotiated with CAP, it rides on `message-tags`. Some
 * servers advertise a matching capability anyway and gate the feature on it, so
 * those unprefixed names appear below.
 */
export const REQUESTED_CAPS = [
  'cap-notify',
  'message-tags',
  'batch',
  'labeled-response',
  'echo-message',
  'server-time',
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
  'no-implicit-names',
  'account-extban',
  'monitor',
  'extended-monitor',
  // Not registered — WHOX is de facto throughout, signalled by the WHOX
  // ISUPPORT token. Kept because a server that gates the 354 reply on a
  // capability of this name would otherwise answer a WHOX query with a plain
  // WHO, and asking for a name nobody advertises costs nothing.
  'whox',
  'draft/message-redaction',
  'draft/message-edit',
  'draft/chathistory',
  'draft/read-marker',
  'draft/webpush',
  'draft/multiline',
  'draft/channel-rename',
  'draft/account-registration',
  'draft/metadata-2',
  'draft/event-playback',
  'draft/pre-away',
  // Deliberately absent: draft/persistence. It is a real capability, and
  // nothing here implements the PERSISTENCE command — asking for it would
  // change what a server does when we disappear, on the strength of support we
  // do not have.
  'draft/search',
  'draft/auto-join',
  'draft/client-batch',
  // Marks messages from network operators, so someone claiming to be staff
  // can be told apart from someone who is.
  'draft/oper-tag',
  'draft/extended-isupport',
  // Server-side names for features that are client tags in the spec
  'draft/channel-context',
  'draft/react',
  'draft/unreact',
  'typing',
  'reply'
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

/**
 * Slash commands the client understands.
 *
 * The parser in main/irc/commands.ts and the composer's completion both read
 * this, so the two cannot drift apart — offering a command that then gets sent
 * to the channel as plain text is worse than not offering it at all.
 */
export const IRC_COMMANDS = [
  'me',
  'join',
  'part',
  'nick',
  'msg',
  'query',
  'notice',
  'whois',
  'topic',
  'mode',
  'kick',
  'invite',
  'away',
  'back',
  'quit',
  'raw'
] as const
