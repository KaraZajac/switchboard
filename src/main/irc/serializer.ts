import type { IRCMessage } from '@shared/types/irc'
import { TAG_UNESCAPE_MAP } from '@shared/constants'

/**
 * Serialize an IRCMessage back to a raw IRC line.
 */
export function serializeMessage(msg: Partial<IRCMessage> & { command: string }): string {
  const parts: string[] = []

  // Tags
  if (msg.tags && Object.keys(msg.tags).length > 0) {
    const tagParts: string[] = []
    for (const [key, value] of Object.entries(msg.tags)) {
      if (value === true) {
        tagParts.push(key)
      } else {
        tagParts.push(`${key}=${escapeTagValue(value)}`)
      }
    }
    parts.push(`@${tagParts.join(';')}`)
  }

  // Prefix
  if (msg.prefix) {
    parts.push(`:${msg.prefix}`)
  }

  // Command
  parts.push(msg.command)

  // Params
  if (msg.params && msg.params.length > 0) {
    for (let i = 0; i < msg.params.length; i++) {
      const param = msg.params[i]
      if (i === msg.params.length - 1 && trailing(msg.command, param)) {
        parts.push(`:${param}`)
      } else {
        parts.push(param)
      }
    }
  }

  return parts.join(' ')
}

/**
 * Commands whose last parameter is a piece of human text.
 *
 * These always take the trailing form, single word or not — it is what every
 * other client sends, and a bare last word invites a sloppy relay to split it.
 */
const TEXT_TRAILING = new Set([
  'PRIVMSG',
  'NOTICE',
  'TOPIC',
  'PART',
  'QUIT',
  'KICK',
  'AWAY',
  'SETNAME',
  'WALLOPS',
  'USER'
])

/**
 * Whether the last parameter goes in the trailing form.
 *
 * Free-form text always does. A structured token does so only when it has no
 * other form — empty, containing a space, or starting with a colon. Marking
 * every last parameter as trailing is legal but produces lines nothing else
 * sends (`CAP LS :302`, `METADATA * SUB a b :c`), and a server that matches a
 * subcommand as a literal token then quietly does nothing.
 */
function trailing(command: string, param: string): boolean {
  if (TEXT_TRAILING.has(command.toUpperCase())) return true
  return param === '' || param.includes(' ') || param.startsWith(':')
}

/** Escape a tag value per IRCv3 spec */
function escapeTagValue(value: string): string {
  let result = ''
  for (const char of value) {
    if (char in TAG_UNESCAPE_MAP) {
      result += TAG_UNESCAPE_MAP[char]
    } else {
      result += char
    }
  }
  return result
}

/** Helper to build a simple command string */
export function cmd(command: string, ...params: string[]): string {
  return serializeMessage({ command, params })
}
