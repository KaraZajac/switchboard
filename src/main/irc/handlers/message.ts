import { serverTimeOf } from '@shared/servertime'
import { registerHandler } from './registry'
import { operFrom, relayedBy } from '@shared/tags'
import { isServerSource } from '@shared/source'
import { statusTarget } from '@shared/isupport'
import { ctcpReply, ctcpKind, ctcpBody, ctcpAnswerLine, CtcpGuard } from '@shared/ctcp'

/**
 * What we say we are, when asked.
 *
 * Set once at startup. Not read from `electron` here, because these handlers
 * are exercised in plain Node — and the string was hardcoded as "1.0" for long
 * enough that every CTCP VERSION reply this client has ever sent named a
 * version it has not been since.
 */
let appVersion = '0.0.0'
let appPlatform = 'unknown'

/** Tell the protocol layer what to answer CTCP VERSION with */
export function setAppVersion(version: string, platform: string): void {
  appVersion = version
  appPlatform = platform
}

function ctcpAnswer(verb: string, args: string): string | null {
  return ctcpReply(verb, args, { version: appVersion, platform: appPlatform, now: new Date() })
}

/**
 * How often this client will answer, per connection.
 *
 * Per connection rather than one for the whole app: two networks are two
 * different rooms of people, and a survey on one should not use up the answer
 * owed to somebody on the other.
 */
const guards = new WeakMap<object, CtcpGuard>()

function guardFor(client: object): CtcpGuard {
  let guard = guards.get(client)
  if (!guard) {
    guard = new CtcpGuard()
    guards.set(client, guard)
  }
  return guard
}

/**
 * PRIVMSG — Channel or private message
 */
registerHandler('PRIVMSG', (client, msg) => {
  const target = msg.params[0]
  const text = msg.params[1] || ''
  const nick = msg.source?.nick || ''

  // Handle CTCP requests — see `ctcpKind`, which tells the three apart for
  // both clients
  if (ctcpKind('PRIVMSG', text) === 'request') {
    const ctcpContent = ctcpBody(text)
    const spaceIdx = ctcpContent.indexOf(' ')
    const ctcpCommand = spaceIdx === -1 ? ctcpContent : ctcpContent.slice(0, spaceIdx)
    const ctcpArgs = spaceIdx === -1 ? '' : ctcpContent.slice(spaceIdx + 1)

    const askedOfUs = client.state.casemap(target) === client.state.casemap(client.state.nick)

    // DCC is an offer rather than a question, so it gets no NOTICE back — and
    // only ever from somebody talking to us directly. A DCC sent to a channel
    // is an offer made to everyone at once, which is not how anybody sends a
    // file to a person.
    if (askedOfUs && ctcpCommand.toUpperCase() === 'DCC') {
      client.events.emit('dcc', { nick, body: ctcpContent })
      return
    }

    /*
     * Answered whether it was asked of us or of the channel.
     *
     * Asking a channel is how people ask — it is the only way to find out what
     * everyone in a room is running — and staying silent meant a survey came
     * back with an answer from every client present except this one. Somebody
     * on IRC reported that as Switchboard not supporting CTCP, which from
     * where they were standing it was.
     *
     * The old silence was not wrong about the risk, only about the remedy: a
     * room full of clients all answering at once is a flood. So the answer is
     * rate limited rather than withheld, which is what every other client
     * does. See `CtcpGuard`.
     */
    const answer = ctcpAnswer(ctcpCommand.toUpperCase(), ctcpArgs)
    if (answer && nick && guardFor(client).allow(nick, Date.now())) {
      client.connection.sendRaw(`NOTICE ${nick} :\x01${answer}\x01`)
    }
    // Don't display CTCP requests to the user
    return
  }

  // Determine if this is an ACTION (/me) — one rule, shared with the phone
  const isAction = ctcpKind('PRIVMSG', text) === 'action'
  const content = isAction ? ctcpBody(text).slice('ACTION '.length) : text

  // Determine the "channel" for display purposes
  // If target is our nick, it's a PM — use the sender's nick as the channel key
  const isPrivate = client.state.casemap(target) === client.state.casemap(client.state.nick)
  // `@#chan` is still #chan: ops and bots address half a room at a time, and
  // the prefix used to open a second conversation beside the real one.
  const addressed = statusTarget(target, client.state.isupport['STATUSMSG']).target
  const channel = isPrivate ? nick : addressed

  // Extract relevant tags
  const msgid = typeof msg.tags['msgid'] === 'string' ? msg.tags['msgid'] : undefined
  // A tag we are willing to store, or now — see `@shared/servertime`
  const time = serverTimeOf(msg.tags['time'] as string | undefined, () => new Date().toISOString())
  const account = typeof msg.tags['account'] === 'string' ? msg.tags['account'] : undefined
  // Both spellings, for the same reason the reaction tags below take both:
  // these specs are drafts, implementations differ on the prefix, and a reply
  // whose link silently does not arrive is indistinguishable from a message
  // nobody was answering. This path took `+reply` only, so a server sending
  // the draft spelling — which is the spelling this client itself sends —
  // dropped the quote and the message arrived looking like a new thought.
  // `?? undefined` so absent stays absent: `tagValue` answers with null, and
  // the difference travels — null survives a trip through JSON to the window
  // and undefined does not.
  const replyTo = tagValue(msg.tags, '+draft/reply', '+reply') ?? undefined
  const label = typeof msg.tags['label'] === 'string' ? msg.tags['label'] : undefined
  const editOf = tagValue(msg.tags, '+draft/edit', '+edit') ?? undefined
  const oper = operFrom(msg.tags)
  const relayed = relayedBy(msg.tags)

  // Check if this is an echo of our own message
  const isEcho = client.state.casemap(nick) === client.state.casemap(client.state.nick)

  client.events.emit('privmsg', {
    channel,
    nick,
    content,
    type: isAction ? 'action' : 'privmsg',
    isPrivate,
    isEcho,
    msgid,
    time,
    account,
    replyTo,
    editOf,
    label,
    oper,
    relayedBy: relayed,
    userHost: msg.source ? `${msg.source.user || ''}@${msg.source.host || ''}` : null,
    tags: msg.tags
  })
})

/**
 * NOTICE — Channel or private notice
 */
registerHandler('NOTICE', (client, msg) => {
  const target = msg.params[0]
  const text = msg.params[1] || ''
  const nick = msg.source?.nick || ''

  /*
   * An answer to something we asked, in the console.
   *
   * Dropped outright until now, which made asking CTCP VERSION of somebody
   * look like it did nothing at all: the reply arrived, was recognised as a
   * reply, and was thrown away. It is two clients talking rather than two
   * people, so it belongs in the console and never in a conversation — which
   * is the other half of this: the phone filed these as ordinary notices and
   * opened a direct message with whoever answered.
   *
   * Ours are dropped rather than shown. With `echo-message` our own reply to
   * somebody else's question comes straight back, and this client answering a
   * question is not news to the person using it.
   */
  if (ctcpKind('NOTICE', text) === 'reply') {
    if (client.state.casemap(nick) === client.state.casemap(client.state.nick)) return

    client.events.emit('notice', {
      channel: '*',
      nick: '',
      content: ctcpAnswerLine(nick, ctcpBody(text)),
      type: 'system',
      isPrivate: true,
      msgid: typeof msg.tags['msgid'] === 'string' ? msg.tags['msgid'] : undefined,
      time: serverTimeOf(msg.tags['time'] as string | undefined, () => new Date().toISOString()),
      tags: msg.tags
    })
    return
  }

  const isPrivate =
    client.state.casemap(target) === client.state.casemap(client.state.nick) || target === '*'
  // A server's notice belongs in the console, not in a conversation named
  // after the server. Rizon sends its connection banner from irc.rizon.life,
  // which used to sit in Direct Messages between two real people.
  const addressed = statusTarget(target, client.state.isupport['STATUSMSG']).target
  const channel = isPrivate ? (isServerSource(msg.prefix) ? '*' : nick) : addressed

  const msgid = typeof msg.tags['msgid'] === 'string' ? msg.tags['msgid'] : undefined
  // A tag we are willing to store, or now — see `@shared/servertime`
  const time = serverTimeOf(msg.tags['time'] as string | undefined, () => new Date().toISOString())

  client.events.emit('notice', {
    channel,
    nick,
    content: text,
    type: 'notice',
    isPrivate,
    msgid,
    time,
    tags: msg.tags
  })
})

/**
 * QUIT — Someone disconnected from the server
 */
registerHandler('QUIT', (client, msg) => {
  const nick = msg.source?.nick || ''
  const reason = msg.params[0] || null

  // Remove user from all channels
  for (const [, channel] of client.state.channels) {
    channel.removeUser(nick)
  }

  client.events.emit('quit', { nick, reason })
})

/**
 * TAGMSG — A message with tags but no text content
 */
registerHandler('TAGMSG', (client, msg) => {
  const target = msg.params[0]
  const nick = msg.source?.nick || ''

  const isPrivate = client.state.casemap(target) === client.state.casemap(client.state.nick)
  const channel = isPrivate ? nick : target

  // Handle typing notifications (skip our own echoed typing)
  const typing = msg.tags['+typing'] ?? msg.tags['+draft/typing']
  if (typeof typing === 'string') {
    if (client.state.casemap(nick) !== client.state.casemap(client.state.nick)) {
      client.events.emit('typing', {
        channel,
        nick,
        status: typing as 'active' | 'paused' | 'done'
      })
    }
    return
  }

  // Reactions. Both spellings of each tag are accepted: the specs are drafts,
  // implementations differ on the prefix, and a reaction that silently does
  // not arrive is indistinguishable from one nobody sent.
  const react = tagValue(msg.tags, '+draft/react', '+react')
  const unreact = tagValue(msg.tags, '+draft/unreact', '+unreact')
  const replyTo = tagValue(msg.tags, '+draft/reply', '+reply')

  if ((react || unreact) && replyTo) {
    client.events.emit('react', {
      channel,
      nick,
      emoji: (react ?? unreact) as string,
      msgid: replyTo,
      removed: unreact !== null
    })
    return
  }

  // Generic TAGMSG event
  client.events.emit('tagmsg', {
    channel,
    nick,
    tags: msg.tags
  })
})

/** The first of several tag spellings that is actually present */
function tagValue(tags: Record<string, string | true>, ...names: string[]): string | null {
  for (const name of names) {
    const value = tags[name]
    if (typeof value === 'string') return value
    // A tag with no value still means it is present
    if (value === true) return ''
  }
  return null
}
