import type { IRCMessage, IRCSource } from '@shared/types/irc'
import { TAG_ESCAPE_MAP } from '@shared/constants'

/**
 * Parse an IRC message line into a structured IRCMessage.
 * Supports full IRCv3 message-tags syntax.
 *
 * Format: [@tags] [:prefix] <command> [params...] [:trailing]
 */
export function parseMessage(line: string): IRCMessage {
  let pos = 0
  let tags: Record<string, string | true> = {}
  let prefix: string | null = null

  // Strip trailing \r\n
  if (line.endsWith('\r\n')) {
    line = line.slice(0, -2)
  } else if (line.endsWith('\n')) {
    line = line.slice(0, -1)
  }

  // Parse tags: @key1=value1;key2;key3=value3
  if (line[pos] === '@') {
    const spaceIdx = line.indexOf(' ', pos)
    if (spaceIdx === -1) {
      throw new Error('Malformed IRC message: tags without command')
    }
    const tagStr = line.slice(1, spaceIdx)
    tags = parseTags(tagStr)
    pos = spaceIdx + 1
    // Skip additional spaces
    while (line[pos] === ' ') pos++
  }

  // Parse prefix: :nick!user@host or :servername
  if (line[pos] === ':') {
    const spaceIdx = line.indexOf(' ', pos)
    if (spaceIdx === -1) {
      throw new Error('Malformed IRC message: prefix without command')
    }
    prefix = line.slice(pos + 1, spaceIdx)
    pos = spaceIdx + 1
    while (line[pos] === ' ') pos++
  }

  // Parse command
  const rest = line.slice(pos)
  const params: string[] = []
  let command = ''

  const parts = rest.split(' ')
  command = parts[0].toUpperCase()

  // Parse params
  for (let i = 1; i < parts.length; i++) {
    if (parts[i].startsWith(':')) {
      // Trailing parameter — rest of the line
      params.push(parts.slice(i).join(' ').slice(1))
      break
    }
    if (parts[i] !== '') {
      params.push(parts[i])
    }
  }

  return {
    tags,
    prefix,
    source: prefix ? parsePrefix(prefix) : null,
    command,
    params
  }
}

/** Parse tag string into key-value pairs */
function parseTags(tagStr: string): Record<string, string | true> {
  const tags: Record<string, string | true> = {}
  for (const part of tagStr.split(';')) {
    const eqIdx = part.indexOf('=')
    if (eqIdx === -1) {
      tags[part] = true
    } else {
      const key = part.slice(0, eqIdx)
      const rawValue = part.slice(eqIdx + 1)
      tags[key] = unescapeTagValue(rawValue)
    }
  }
  return tags
}

/** Unescape an IRCv3 tag value */
function unescapeTagValue(value: string): string {
  let result = ''
  for (let i = 0; i < value.length; i++) {
    if (value[i] === '\\' && i + 1 < value.length) {
      const seq = value.slice(i, i + 2)
      if (seq in TAG_ESCAPE_MAP) {
        result += TAG_ESCAPE_MAP[seq]
        i++
      } else {
        // Unknown escape — drop the backslash per spec
        result += value[i + 1]
        i++
      }
    } else {
      result += value[i]
    }
  }
  return result
}

/** Parse a prefix string into nick/user/host components */
function parsePrefix(prefix: string): IRCSource {
  const bangIdx = prefix.indexOf('!')
  const atIdx = prefix.indexOf('@')

  if (bangIdx !== -1 && atIdx !== -1 && atIdx > bangIdx) {
    return {
      nick: prefix.slice(0, bangIdx),
      user: prefix.slice(bangIdx + 1, atIdx),
      host: prefix.slice(atIdx + 1)
    }
  }

  if (atIdx !== -1) {
    return {
      nick: prefix.slice(0, atIdx),
      user: null,
      host: prefix.slice(atIdx + 1)
    }
  }

  return {
    nick: prefix,
    user: null,
    host: null
  }
}
