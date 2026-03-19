import { registerHandler } from './registry'
import type { ChannelUser } from '@shared/types/channel'

/**
 * JOIN — Someone joined a channel
 */
registerHandler('JOIN', (client, msg) => {
  const nick = msg.source?.nick || ''
  const channel = msg.params[0]
  // extended-join: params may include account and realname
  const account = msg.params[1] !== '*' ? msg.params[1] : null
  const realname = msg.params[2] || null

  const isMe = nick.toLowerCase() === client.state.nick.toLowerCase()

  if (isMe) {
    // We joined — create channel state
    client.state.getChannel(channel)
  }

  const ch = client.state.channels.get(channel.toLowerCase())
  if (ch) {
    const user = ch.setUser(nick, {
      nick,
      user: msg.source?.user ?? null,
      host: msg.source?.host ?? null,
      account: account ?? undefined,
      realname: realname ?? undefined,
      prefixes: []
    })

    client.events.emit('join', { channel: ch.name, user, isMe })
  }
})

/**
 * PART — Someone left a channel
 */
registerHandler('PART', (client, msg) => {
  const nick = msg.source?.nick || ''
  const channel = msg.params[0]
  const reason = msg.params[1] || null

  const isMe = nick.toLowerCase() === client.state.nick.toLowerCase()

  const ch = client.state.channels.get(channel.toLowerCase())
  if (ch) {
    ch.removeUser(nick)
  }

  if (isMe) {
    client.state.removeChannel(channel)
  }

  client.events.emit('part', { channel, nick, reason, isMe })
})

/**
 * KICK — Someone was kicked from a channel
 */
registerHandler('KICK', (client, msg) => {
  const channel = msg.params[0]
  const kicked = msg.params[1]
  const reason = msg.params[2] || null
  const by = msg.source?.nick || ''

  const isMe = kicked.toLowerCase() === client.state.nick.toLowerCase()

  const ch = client.state.channels.get(channel.toLowerCase())
  if (ch) {
    ch.removeUser(kicked)
  }

  if (isMe) {
    client.state.removeChannel(channel)
  }

  client.events.emit('kick', { channel, nick: kicked, by, reason, isMe })
})

/**
 * TOPIC — Channel topic changed
 */
registerHandler('TOPIC', (client, msg) => {
  const channel = msg.params[0]
  const topic = msg.params[1] || ''
  const setBy = msg.source?.nick || null

  const ch = client.state.channels.get(channel.toLowerCase())
  if (ch) {
    ch.topic = topic
    ch.topicSetBy = setBy
    ch.topicSetAt = new Date().toISOString()
  }

  client.events.emit('topic', { channel, topic, setBy })
})

/**
 * RPL_TOPIC (332) — Topic for a channel (on join)
 */
registerHandler('332', (client, msg) => {
  // params: <nick> <channel> :<topic>
  const channel = msg.params[1]
  const topic = msg.params[2] || ''

  const ch = client.state.channels.get(channel.toLowerCase())
  if (ch) {
    ch.topic = topic
  }

  client.events.emit('topic', { channel, topic, setBy: null })
})

/**
 * RPL_TOPICWHOTIME (333) — Who set the topic and when
 */
registerHandler('333', (client, msg) => {
  // params: <nick> <channel> <setter> <timestamp>
  const channel = msg.params[1]
  const setBy = msg.params[2]
  const timestamp = msg.params[3]

  const ch = client.state.channels.get(channel.toLowerCase())
  if (ch) {
    ch.topicSetBy = setBy
    ch.topicSetAt = timestamp
      ? new Date(parseInt(timestamp) * 1000).toISOString()
      : null
  }
})

/**
 * RPL_NAMREPLY (353) — Names list for a channel
 */
registerHandler('353', (client, msg) => {
  // params: <nick> <symbol> <channel> :<names list>
  const channel = msg.params[2]
  const namesList = msg.params[3] || ''

  const ch = client.state.channels.get(channel.toLowerCase())
  if (!ch) return

  // Get prefix characters from ISUPPORT or use defaults
  const prefixMap = parsePrefixIsupport(client.state.isupport['PREFIX'] as string | undefined)
  const prefixChars = new Set(Object.values(prefixMap))

  for (const entry of namesList.split(' ')) {
    if (!entry) continue

    // Extract prefixes from the front of the entry
    const prefixes: string[] = []
    let i = 0
    while (i < entry.length && prefixChars.has(entry[i])) {
      prefixes.push(entry[i])
      i++
    }

    const rest = entry.slice(i)

    // userhost-in-names: nick may be nick!user@host
    let nick: string
    let user: string | null = null
    let host: string | null = null

    const bangIdx = rest.indexOf('!')
    const atIdx = rest.indexOf('@')
    if (bangIdx !== -1 && atIdx !== -1 && atIdx > bangIdx) {
      nick = rest.slice(0, bangIdx)
      user = rest.slice(bangIdx + 1, atIdx)
      host = rest.slice(atIdx + 1)
    } else {
      nick = rest
    }

    ch.setUser(nick, { nick, user, host, prefixes })
  }
})

/**
 * RPL_ENDOFNAMES (366) — End of names list
 */
registerHandler('366', (client, msg) => {
  // params: <nick> <channel> :End of /NAMES list
  const channel = msg.params[1]
  const ch = client.state.channels.get(channel.toLowerCase())
  if (ch) {
    ch.namesReceived = true
    const users: ChannelUser[] = Array.from(ch.users.values())
    client.events.emit('names', { channel: ch.name, users })
  }
})

/**
 * MODE — Channel or user mode change
 */
registerHandler('MODE', (client, msg) => {
  const target = msg.params[0]

  // Channel mode
  if (target.startsWith('#') || target.startsWith('&') || target.startsWith('!') || target.startsWith('+')) {
    const modeStr = msg.params[1] || ''
    const modeParams = msg.params.slice(2)
    const setBy = msg.source?.nick || null

    const ch = client.state.channels.get(target.toLowerCase())
    if (ch) {
      applyChannelModes(ch, modeStr, modeParams, client)
    }

    client.events.emit('mode', {
      channel: target,
      mode: modeStr,
      params: modeParams,
      setBy
    })
  }
  // User mode changes (for our nick) are not typically displayed in the UI
})

/**
 * INVITE — We were invited to a channel
 */
registerHandler('INVITE', (client, msg) => {
  const target = msg.params[0]
  const channel = msg.params[1]
  const by = msg.source?.nick || ''

  const isMe = target.toLowerCase() === client.state.nick.toLowerCase()

  client.events.emit('invite', { channel, by, target, isMe })
})

/**
 * RPL_LIST (322) — Channel list entry
 */
registerHandler('322', (client, msg) => {
  // params: <nick> <channel> <user_count> :<topic>
  const name = msg.params[1]
  const userCount = parseInt(msg.params[2]) || 0
  const topic = msg.params[3] || ''

  if (!client.state.listInProgress) {
    client.state.listInProgress = true
    client.state.listEntries = []
  }

  client.state.listEntries.push({ name, userCount, topic })
})

/**
 * RPL_LISTEND (323) — End of channel list
 */
registerHandler('323', (client, _msg) => {
  client.state.listInProgress = false
  client.events.emit('channelList', client.state.listEntries)
  client.state.listEntries = []
})

// ── Helpers ────────────────────────────────────────────────────────

/**
 * Parse the PREFIX ISUPPORT token.
 * Format: (modes)prefixes — e.g., (ov)@+
 * Returns: { o: '@', v: '+' }
 */
function parsePrefixIsupport(prefix?: string): Record<string, string> {
  if (!prefix || typeof prefix !== 'string') {
    // Defaults
    return { q: '~', a: '&', o: '@', h: '%', v: '+' }
  }

  const match = prefix.match(/^\(([^)]+)\)(.+)$/)
  if (!match) {
    return { q: '~', a: '&', o: '@', h: '%', v: '+' }
  }

  const modes = match[1]
  const chars = match[2]
  const map: Record<string, string> = {}
  for (let i = 0; i < modes.length && i < chars.length; i++) {
    map[modes[i]] = chars[i]
  }
  return map
}

/**
 * Apply mode changes to a channel.
 * Handles +/- mode parsing with parameters for prefix modes.
 */
function applyChannelModes(
  ch: ReturnType<typeof import('../state').ConnectionState.prototype.getChannel>,
  modeStr: string,
  params: string[],
  client: { state: { isupport: Record<string, string | true> } }
): void {
  const prefixMap = parsePrefixIsupport(client.state.isupport['PREFIX'] as string | undefined)
  const prefixModes = new Set(Object.keys(prefixMap))

  let adding = true
  let paramIdx = 0

  for (const char of modeStr) {
    if (char === '+') {
      adding = true
      continue
    }
    if (char === '-') {
      adding = false
      continue
    }

    if (prefixModes.has(char)) {
      // Prefix mode — always has a nick parameter
      const nick = params[paramIdx++]
      if (!nick) continue

      const user = ch.users.get(nick.toLowerCase())
      if (user) {
        const prefix = prefixMap[char]
        if (adding) {
          if (!user.prefixes.includes(prefix)) {
            user.prefixes.push(prefix)
          }
        } else {
          user.prefixes = user.prefixes.filter((p) => p !== prefix)
        }
      }
    } else {
      // Channel mode — may or may not have a parameter depending on mode type
      // For simplicity, track all modes. Modes that take params on set:
      // CHANMODES ISUPPORT: A,B,C,D — A always has param, B has param, C param on set only, D never
      const chanmodes = (client.state.isupport['CHANMODES'] as string) || 'b,k,l,imnpst'
      const [listModes = '', paramAlways = '', paramOnSet = ''] = chanmodes.split(',')

      if (listModes.includes(char) || paramAlways.includes(char)) {
        const param = params[paramIdx++]
        if (adding) {
          ch.modes[char] = param || true
        } else {
          delete ch.modes[char]
        }
      } else if (paramOnSet.includes(char)) {
        if (adding) {
          const param = params[paramIdx++]
          ch.modes[char] = param || true
        } else {
          delete ch.modes[char]
        }
      } else {
        if (adding) {
          ch.modes[char] = true
        } else {
          delete ch.modes[char]
        }
      }
    }
  }
}
