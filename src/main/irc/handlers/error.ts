import { registerHandler } from './registry'
import { absenceAction } from '@shared/notonchannel'

/**
 * ERROR — Server-side error (usually before disconnect)
 */
registerHandler('ERROR', (client, msg) => {
  const message = msg.params[msg.params.length - 1] || 'Unknown error'
  // Kept for the reconnect decision: a server saying it is throttling us has
  // told us how to behave, and the answer is not another dial a second later.
  client.connection.noteClosingMessage(message)
  client.events.emit('error', {
    code: 'ERROR',
    command: 'ERROR',
    message
  })
})

/**
 * FAIL — IRCv3 standard reply: failure
 */
registerHandler('FAIL', (client, msg) => {
  // params: <command> <code> [context...] <description>
  const command = msg.params[0] || ''
  const code = msg.params[1] || ''
  const description = msg.params[msg.params.length - 1] || ''

  client.events.emit('error', {
    code,
    command,
    message: description
  })
})

/**
 * WARN — IRCv3 standard reply: warning
 */
registerHandler('WARN', (client, msg) => {
  const command = msg.params[0] || ''
  const code = msg.params[1] || ''
  const description = msg.params[msg.params.length - 1] || ''

  client.events.emit('warn', {
    code,
    command,
    message: description
  })
})

/**
 * NOTE — IRCv3 standard reply: informational
 */
registerHandler('NOTE', (client, msg) => {
  const command = msg.params[0] || ''
  const code = msg.params[1] || ''
  const description = msg.params[msg.params.length - 1] || ''

  client.events.emit('note', {
    code,
    command,
    message: description
  })
})

// ── Common error numerics ──────────────────────────────────────────

/** ERR_NOSUCHNICK (401) */
registerHandler('401', (client, msg) => {
  client.events.emit('error', {
    code: '401',
    command: msg.params[1] || '',
    message: msg.params[2] || 'No such nick/channel'
  })
})

/**
 * ERR_UNKNOWNCOMMAND (421)
 *
 * The server does not know that command. Worth saying: it is the answer to a
 * `/raw` with a typo in it, and to a feature the network turns out not to
 * have. Ignored, it looks exactly like the command having worked.
 */
registerHandler('421', (client, msg) => {
  client.events.emit('error', {
    code: '421',
    command: msg.params[1] || '',
    message: msg.params[2] || 'Unknown command'
  })
})

/**
 * ERR_NOTREGISTERED (451)
 *
 * Sent too early — before 001. Anything we say between CAP END and the welcome
 * comes back as this, which is exactly when a client with a long list of
 * things to do is saying the most.
 */
registerHandler('451', (client, msg) => {
  client.events.emit('error', {
    code: '451',
    command: msg.params[1] || '',
    message: msg.params[2] || 'You have not registered'
  })
})

/**
 * ERR_NOSUCHCHANNEL (403) and ERR_NOTONCHANNEL (442).
 *
 * Both say we are not in the channel named. Where our own list says otherwise,
 * the server is the one that knows — so the channel comes out, and quietly,
 * because "you are not in it" is exactly the outcome somebody asked for when
 * they pressed leave. It used to be an error beside a channel that stayed in
 * the list and could never be left. See `@shared/notonchannel`.
 */
function notOnChannel(code: '403' | '442', fallback: string): void {
  registerHandler(code, (client, msg) => {
    const channel = msg.params[1]
    // Looked up directly: `getChannel` creates one on a miss, which would
    // conjure the very channel this is testing for
    const action = absenceAction(code, channel, (name) =>
      client.state.channels.has(client.state.casemap(name))
    )

    if (action === 'leave' && channel) {
      client.state.removeChannel(channel)
      client.events.emit('part', {
        channel,
        nick: client.state.nick,
        isMe: true,
        reason: undefined,
        time: new Date().toISOString()
      })
      return
    }

    client.events.emit('error', {
      code,
      command: channel || '',
      message: msg.params[2] || fallback
    })
  })
}

notOnChannel('403', 'No such channel')

/** ERR_CANNOTSENDTOCHAN (404) */
registerHandler('404', (client, msg) => {
  client.events.emit('error', {
    code: '404',
    command: msg.params[1] || '',
    message: msg.params[2] || 'Cannot send to channel'
  })
})

/** ERR_TOOMANYCHANNELS (405) */
registerHandler('405', (client, msg) => {
  client.events.emit('error', {
    code: '405',
    command: msg.params[1] || '',
    message: msg.params[2] || 'Too many channels'
  })
})

/** ERR_NOTONCHANNEL (442) */
notOnChannel('442', "You're not on that channel")

/** ERR_NEEDMOREPARAMS (461) */
registerHandler('461', (client, msg) => {
  client.events.emit('error', {
    code: '461',
    command: msg.params[1] || '',
    message: msg.params[2] || 'Not enough parameters'
  })
})

/** ERR_CHANOPRIVSNEEDED (482) */
registerHandler('482', (client, msg) => {
  client.events.emit('error', {
    code: '482',
    command: msg.params[1] || '',
    message: msg.params[2] || "You're not a channel operator"
  })
})

/**
 * A join that failed, reported only if somebody here asked for it.
 *
 * `irc.d0ll.link` has `set::auto-join "#default"`, so every connection is put
 * into a channel it never asked about — and that channel bans the people it
 * force-joins, which is a fight between two server settings rather than
 * anything this client did. Reporting it meant a "Cannot join channel (+b)"
 * toast on every single connect, naming a channel the user has never heard
 * of and cannot act on.
 *
 * `takeJoinReason` already knows the difference: `server` means nobody here
 * sent the `JOIN`. Those are logged and dropped. Everything else — `/join`,
 * a channel clicked in the list, the auto-join list this client keeps — is a
 * request somebody made and is owed an answer.
 */
function joinFailed(code: string, fallback: string): void {
  registerHandler(code, (client, msg) => {
    const channel = msg.params[1] || ''
    const message = msg.params[2] || fallback

    if (channel && client.takeJoinReason(channel) === 'server') {
      console.log(
        `${client.config.name}: ${channel} refused a join nobody here asked for — ${message}`
      )
      return
    }

    client.events.emit('error', { code, command: channel, message })
  })
}

/** ERR_BANNEDFROMCHAN */
joinFailed('474', 'Cannot join channel (+b)')

/** ERR_INVITEONLYCHAN */
joinFailed('473', 'Cannot join channel (+i)')

/** ERR_BADCHANNELKEY */
joinFailed('475', 'Cannot join channel (+k)')

/**
 * ERR_NEEDREGGEDNICK — the channel wants you logged in.
 *
 * On rIRCd that is what creating a channel takes, so somebody joining a
 * channel that does not exist yet was refused — and nothing was listening,
 * so the join simply did not happen: no channel, no error, nothing to press.
 */
joinFailed('477', 'You need to be logged in to an account to join that channel')

/** ERR_CHANNELISFULL */
joinFailed('471', 'Cannot join channel (+l)')
