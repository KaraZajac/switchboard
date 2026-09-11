import { registerHandler } from './registry'
import { readListReply, maskListsFor, type MaskEntry } from '@shared/masklists'
import { parsePrefix } from '@shared/powers'
import { hasMetadata } from '@shared/metadata'
import type { ChannelUser } from '@shared/types/channel'
import { sendWHOX } from '../features/whox'
import { syncMetadata } from '../features/metadata'
import { advertises } from '@shared/isupport'

/**
 * JOIN — Someone joined a channel
 */
registerHandler('JOIN', (client, msg) => {
  const nick = msg.source?.nick || ''
  const channel = msg.params[0]
  // extended-join: params may include account and realname
  const account = msg.params[1] !== '*' ? msg.params[1] : null
  const realname = msg.params[2] || null

  const isMe = client.state.casemap(nick) === client.state.casemap(client.state.nick)

  if (isMe) {
    // Our own JOIN carries our full mask, and it is the first time the server
    // shows it to us. Worth keeping: it is what gets prepended to everything
    // we say, so it decides how long a message can be.
    if (msg.source?.user && msg.source?.host) {
      client.state.userHost = `${msg.source.user}@${msg.source.host}`
    }

    // We joined — create channel state
    client.state.getChannel(channel)

    // Everyone's avatars, display names and colours for this channel in one go
    if (hasMetadata(client.state.capabilities)) {
      syncMetadata(client, channel)
    }

    // With no-implicit-names the server will not send NAMES on its own, so ask.
    //
    // NAMES rather than WHOX, even where WHOX is available: the 366 that ends
    // it is what marks the roster complete, and the WHOX enrichment already
    // hangs off that. Asking WHOX first only means asking twice — once here,
    // and again when the NAMES we still needed comes back.
    if (client.state.capabilities.has('no-implicit-names')) {
      client.connection.send('NAMES', channel)
    }
  }

  // Someone else arriving: the server pushed everyone's metadata when *we*
  // joined, but not for people who show up afterwards, so ask for theirs.
  if (!isMe && nick && hasMetadata(client.state.capabilities)) {
    syncMetadata(client, nick)
  }

  const ch = client.state.channels.get(client.state.casemap(channel))
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

  const isMe = client.state.casemap(nick) === client.state.casemap(client.state.nick)

  const ch = client.state.channels.get(client.state.casemap(channel))
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

  const isMe = client.state.casemap(kicked) === client.state.casemap(client.state.nick)

  const ch = client.state.channels.get(client.state.casemap(channel))
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

  const ch = client.state.channels.get(client.state.casemap(channel))
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

  const ch = client.state.channels.get(client.state.casemap(channel))
  if (ch) {
    ch.topic = topic
  }

  client.events.emit('topic', { channel, topic, setBy: null })
})

/**
 * RPL_CHANNELMODEIS (324) — the modes a channel has, when asked
 *
 * `/mode #channel` sends the query and this is the answer. Nothing read it, so
 * the command did nothing anyone could see — while the phone applied it. The
 * MODE *command* handler covers the modes a server volunteers on join; this is
 * the one you get for asking.
 */
registerHandler('324', (client, msg) => {
  // params: <nick> <channel> <modes> [params...]
  const ch = client.state.channels.get(client.state.casemap(msg.params[1]))
  if (!ch) return

  applyChannelModes(ch, msg.params[2] || '', msg.params.slice(3), client)
})

/**
 * RPL_NOTOPIC (331) — This channel has no topic
 *
 * The answer to joining a channel nobody has ever set a topic on, and to
 * asking about one whose topic has since been cleared. Without it the last
 * topic we were told about stayed in the header, so a rejoin after somebody
 * emptied it went on showing a topic that no longer existed.
 */
registerHandler('331', (client, msg) => {
  // params: <nick> <channel> :No topic is set
  const channel = msg.params[1]

  const ch = client.state.channels.get(client.state.casemap(channel))
  if (ch) {
    ch.topic = null
    ch.topicSetBy = null
    ch.topicSetAt = null
  }

  client.events.emit('topic', { channel, topic: '', setBy: null })
})

/**
 * RPL_TOPICWHOTIME (333) — Who set the topic and when
 */
registerHandler('333', (client, msg) => {
  // params: <nick> <channel> <setter> <timestamp>
  const channel = msg.params[1]
  const setBy = msg.params[2]
  const timestamp = msg.params[3]

  const ch = client.state.channels.get(client.state.casemap(channel))
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

  const ch = client.state.channels.get(client.state.casemap(channel))
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
  const ch = client.state.channels.get(client.state.casemap(channel))
  if (ch) {
    ch.namesReceived = true
    const users: ChannelUser[] = Array.from(ch.users.values())
    client.events.emit('names', { channel: ch.name, users })

    // Auto-WHOX for richer user data (bot flags, accounts, away status).
    // Asked as a presence question: UnrealIRCd advertises this as `WHOX=`,
    // with nothing after the equals sign, and an empty string is falsy.
    if (advertises(client.state.isupport, 'WHOX')) {
      sendWHOX(client, channel)
    }
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

    const ch = client.state.channels.get(client.state.casemap(target))
    if (ch) {
      applyChannelModes(ch, modeStr, modeParams, client)
      trackMaskListChange(client, ch, target, modeStr, modeParams)
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

  const isMe = client.state.casemap(target) === client.state.casemap(client.state.nick)

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
  client: { state: { isupport: Record<string, string | true>; casemap(name: string): string } }
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

      const user = ch.users.get(client.state.casemap(nick))
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

// ── The lists a channel keeps ────────────────────────────────────────

/**
 * RPL_BANLIST and its relatives — 367/368, 346/347, 348/349, 728/729.
 *
 * None of these were handled at all, which meant a client that could set a ban
 * had no way to show one. You could put somebody on a list and never find them
 * again: not to lift it, not to check that the mask you guessed at matched
 * anything, not to see what the last operator did.
 *
 * Which numeric means which list, and how to read each shape, is in
 * `@shared/masklists` — because 728 puts its mode letter where the others put
 * the mask, and getting that wrong lists the letter `q` as though somebody had
 * banned it.
 */
for (const numeric of ['367', '368', '346', '347', '348', '349', '728', '729']) {
  registerHandler(numeric, (client, msg) => {
    const reply = readListReply(numeric, msg.params)
    if (!reply) return

    const ch = client.state.channels.get(client.state.casemap(reply.channel))
    if (!ch) return

    if (reply.done) {
      ch.loadingLists.delete(reply.mode)
      client.events.emit('masklist', {
        channel: reply.channel,
        mode: reply.mode,
        entries: ch.maskLists.get(reply.mode) ?? [],
        done: true
      })
      return
    }

    // The first line of a fresh fetch replaces what we had. A list is sent
    // whole, so appending would double it every time somebody looked.
    if (ch.loadingLists.has(reply.mode)) {
      ch.maskLists.set(reply.mode, [])
      ch.loadingLists.delete(reply.mode)
    }

    const entries = ch.maskLists.get(reply.mode) ?? []
    if (!entries.some((e: MaskEntry) => e.mask === reply.entry!.mask)) entries.push(reply.entry!)
    ch.maskLists.set(reply.mode, entries)
  })
}

/**
 * Keep a mask list in step with a MODE that changed it.
 *
 * Otherwise banning somebody and then opening the list shows the list as it
 * was before you banned them, until something refetches — which reads as the
 * ban not having worked. Cheaper and more truthful than asking the server
 * again on every change, and the panel can still refresh by hand.
 */
function trackMaskListChange(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ch: any,
  channel: string,
  modeStr: string,
  params: string[]
): void {
  const lists = maskListsFor(client.state.isupport.CHANMODES, client.state.isupport.PREFIX)
  if (lists.length === 0) return

  const listModes = new Set(lists.map((l) => l.mode))
  let adding = true
  let at = 0

  for (const char of modeStr) {
    if (char === '+') { adding = true; continue }
    if (char === '-') { adding = false; continue }
    if (!listModes.has(char)) {
      // Only list modes are tracked here, but every mode that takes a
      // parameter still consumes one — miscounting would attribute the wrong
      // mask to the ban.
      if (takesParameter(client, char, adding)) at++
      continue
    }

    const mask = params[at++]
    if (!mask) continue

    const entries = ch.maskLists.get(char) ?? []
    if (adding) {
      if (!entries.some((e: MaskEntry) => e.mask === mask)) {
        entries.push({ mask, setBy: client.state.nick, setAt: Math.floor(Date.now() / 1000) })
      }
    } else {
      const found = entries.findIndex((e: MaskEntry) => e.mask === mask)
      if (found !== -1) entries.splice(found, 1)
    }
    ch.maskLists.set(char, entries)

    client.events.emit('masklist', { channel, mode: char, entries, done: true })
  }
}

/** Whether this mode letter consumes a parameter in this direction */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function takesParameter(client: any, char: string, adding: boolean): boolean {
  const [typeA = '', typeB = '', typeC = ''] = (client.state.isupport.CHANMODES || '').split(',')
  const scheme = parsePrefix(client.state.isupport.PREFIX)
  if (scheme.modes.includes(char)) return true
  if (typeA.includes(char)) return true
  if (typeB.includes(char)) return true
  if (typeC.includes(char)) return adding
  return false
}
