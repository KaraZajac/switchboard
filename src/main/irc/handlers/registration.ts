import { registerHandler } from './registry'

/**
 * RPL_WELCOME (001) — Registration successful
 */
registerHandler('001', (client, msg) => {
  const nick = msg.params[0]
  client.state.nick = nick
  client.state.registrationState = 'connected'
  client.state.serverName = msg.prefix || ''

  // Being let in is what makes the last attempt a success, and what starts the
  // reconnect ladder over. Opening a socket is not: a throttle, a ban, a full
  // server and a TLS-only port all accept the connection and close it after.
  client.connection.onRegistered()

  // We are called something, and it is not always what was asked for. Say so
  // now, once it is settled — being quietly renamed and left to notice is how
  // someone spends an evening wondering why nobody answers them.
  if (client.state.desiredNick && client.state.casemap(nick) !== client.state.casemap(client.state.desiredNick)) {
    client.events.emit('error', {
      code: '433',
      command: 'NICK',
      message:
        `Connected as ${nick} rather than ${client.state.desiredNick}` +
        (client.state.nickRefusedReason ? ` — ${client.state.nickRefusedReason}` : '')
    })
  }
  client.state.nickRefusedReason = null

  client.events.emit('registered', {
    nick,
    message: msg.params[1] || ''
  })

  // Run identify command then join channels
  // If there's an identify command, delay joining so the server can process auth
  const hasIdentify = !!client.config.identifyCommand?.trim()

  if (hasIdentify) {
    runIdentifyCommand(client)
  }

  const joinDelay = hasIdentify ? 2000 : 0
  if (client.config.autoJoin.length > 0) {
    setTimeout(() => {
      for (const channel of client.config.autoJoin) {
        client.connection.send('JOIN', channel)
      }
    }, joinDelay)
  }
})

/**
 * RPL_YOURHOST (002)
 */
registerHandler('002', (_client, _msg) => {
  // Informational — no action needed
})

/**
 * RPL_CREATED (003)
 */
registerHandler('003', (_client, _msg) => {
  // Informational — no action needed
})

/**
 * RPL_MYINFO (004) — Server info
 */
registerHandler('004', (client, msg) => {
  // params: <nick> <servername> <version> <usermodes> <channelmodes> [chanmodes with params]
  if (msg.params.length >= 4) {
    client.state.serverName = msg.params[1]
  }
})

/**
 * RPL_ISUPPORT (005) — Server feature advertisement
 */
registerHandler('005', (client, msg) => {
  // params: <nick> <token1> <token2> ... :are supported by this server
  // Skip first param (nick) and last param (trailing text)
  const tokens = msg.params.slice(1, -1)

  for (const token of tokens) {
    const eqIdx = token.indexOf('=')
    if (eqIdx === -1) {
      if (token.startsWith('-')) {
        // Negation: remove a previously advertised token
        delete client.state.isupport[token.slice(1)]
      } else {
        client.state.isupport[token] = true
      }
    } else {
      const key = token.slice(0, eqIdx)
      const value = token.slice(eqIdx + 1)
      client.state.isupport[key] = value
    }
  }

  client.events.emit('isupport', { ...client.state.isupport })
})

/**
 * RPL_MOTDSTART (375)
 */
registerHandler('375', (client, _msg) => {
  client.state.motdLines = []
  client.state.motdInProgress = true
})

/**
 * RPL_MOTD (372)
 */
registerHandler('372', (client, msg) => {
  if (client.state.motdInProgress) {
    // params: <nick> :<motd line>
    const line = msg.params[1] || ''
    client.state.motdLines.push(line)
  }
})

/**
 * RPL_ENDOFMOTD (376)
 */
registerHandler('376', (client, _msg) => {
  client.state.motdInProgress = false
  client.events.emit('motd', [...client.state.motdLines])
})

/**
 * ERR_NOMOTD (422)
 */
registerHandler('422', (client, _msg) => {
  client.state.motdInProgress = false
  client.events.emit('motd', [])
})

/**
 * ERR_NICKNAMEINUSE (433)
 */
registerHandler('433', (client, msg) => {
  // params: <current-nick-or-*> <attempted-nick> :Nickname is already in use
  //
  // Whatever we asked for, we did not get it — forget it, so a later NICK for
  // somebody else who takes that name is not mistaken for ours.
  if (client.state.pendingNick !== null &&
    client.state.casemap(client.state.pendingNick) === client.state.casemap(msg.params[1] || '')) {
    client.state.pendingNick = null
  }

  client.state.nickRefusedReason = msg.params[2] || 'the server refused it'

  if (client.state.registrationState !== 'connected') {
    // During registration, try an alternative nick
    const attempted = msg.params[1]
    const altNick = attempted + '_'
    client.state.nick = altNick
    client.connection.send('NICK', altNick)

    // …and keep trying for the real one. Usually the name is only held by a
    // session that is on its way out — our own, on the other device.
    client.startNickRecovery()
  }
  client.events.emit('nickInUse', {
    nick: msg.params[1],
    message: msg.params[2] || 'Nickname is already in use'
  })
})

/**
 * ERR_ERRONEUSNICKNAME (432)
 */
registerHandler('432', (client, msg) => {
  client.events.emit('error', {
    code: '432',
    command: 'NICK',
    message: msg.params[2] || 'Erroneous nickname'
  })
})

/**
 * NICK — Someone (including us) changed their nick
 */
registerHandler('NICK', (client, msg) => {
  const oldNick = msg.source?.nick || ''
  const newNick = msg.params[0]

  // Is this our own change? Normally the prefix says so. When it does not —
  // a server that puts the new nick there instead of the old — the nick we
  // asked for and have not yet heard about does.
  const byPrefix = client.state.casemap(oldNick) === client.state.casemap(client.state.nick)
  const byRequest =
    client.state.pendingNick !== null &&
    client.state.casemap(newNick) === client.state.casemap(client.state.pendingNick)

  if (byPrefix || byRequest) {
    client.state.nick = newNick
    client.state.pendingNick = null
    if (client.state.casemap(newNick) === client.state.casemap(client.state.desiredNick)) {
      client.stopNickRecovery()
    }
  }

  // Update nick in all channels
  for (const [, channel] of client.state.channels) {
    channel.renameUser(oldNick, newNick)
  }

  // A person's profile belongs to the person, not to the name they had at the
  // time. Leaving it behind means a rename — including our own, every time the
  // fallback nick is given back — quietly drops their display name and avatar.
  const from = client.state.casemap(oldNick)
  const to = client.state.casemap(newNick)
  if (from !== to) {
    const profile = client.state.metadata.get(from)
    if (profile) {
      client.state.metadata.delete(from)
      client.state.metadata.set(to, { ...(client.state.metadata.get(to) ?? {}), ...profile })
    }
  }

  client.events.emit('nick', { oldNick, newNick })
})

// ── Helpers ──────────────────────────────────────────────────────

import type { IRCClient } from '../client'

function runIdentifyCommand(client: IRCClient): void {
  const cmd = client.config.identifyCommand?.trim()
  if (!cmd || !cmd.startsWith('/')) return

  const stripped = cmd.slice(1)
  const spaceIdx = stripped.indexOf(' ')
  if (spaceIdx === -1) return

  const command = stripped.slice(0, spaceIdx).toUpperCase()
  const rest = stripped.slice(spaceIdx + 1)

  if (command === 'MSG' || command === 'PRIVMSG') {
    const targetSpaceIdx = rest.indexOf(' ')
    if (targetSpaceIdx !== -1) {
      const target = rest.slice(0, targetSpaceIdx)
      const message = rest.slice(targetSpaceIdx + 1)
      client.connection.send('PRIVMSG', target, message)
    }
  } else if (command === 'QUOTE' || command === 'RAW') {
    client.connection.sendRaw(rest)
  } else {
    client.connection.send(command, ...rest.split(' '))
  }
}
