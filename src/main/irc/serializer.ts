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
      if (i === msg.params.length - 1 && (param.includes(' ') || param.startsWith(':') || msg.params.length > 1)) {
        // Last param uses trailing prefix when it could be ambiguous
        parts.push(`:${param}`)
      } else {
        parts.push(param)
      }
    }
  }

  return parts.join(' ')
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
