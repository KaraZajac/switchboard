import { registerHandler } from './registry'

/** App name and version for CTCP VERSION replies */
const APP_VERSION = 'Switchboard IRC Client 1.0'

/**
 * PRIVMSG — Channel or private message
 */
registerHandler('PRIVMSG', (client, msg) => {
  const target = msg.params[0]
  const text = msg.params[1] || ''
  const nick = msg.source?.nick || ''

  // Handle CTCP requests (wrapped in \x01, but not ACTION)
  if (text.startsWith('\x01') && text.endsWith('\x01') && !text.startsWith('\x01ACTION ')) {
    const ctcpContent = text.slice(1, -1)
    const spaceIdx = ctcpContent.indexOf(' ')
    const ctcpCommand = spaceIdx === -1 ? ctcpContent : ctcpContent.slice(0, spaceIdx)
    const ctcpArgs = spaceIdx === -1 ? '' : ctcpContent.slice(spaceIdx + 1)

    switch (ctcpCommand.toUpperCase()) {
      case 'VERSION':
        client.connection.sendRaw(`NOTICE ${nick} :\x01VERSION ${APP_VERSION}\x01`)
        break
      case 'TIME':
        client.connection.sendRaw(`NOTICE ${nick} :\x01TIME ${new Date().toISOString()}\x01`)
        break
      case 'PING':
        client.connection.sendRaw(`NOTICE ${nick} :\x01PING ${ctcpArgs}\x01`)
        break
      case 'SOURCE':
        client.connection.sendRaw(`NOTICE ${nick} :\x01SOURCE https://github.com/KaraZajac/switchboard\x01`)
        break
    }
    // Don't display CTCP requests to the user
    return
  }

  // Determine if this is an ACTION (/me)
  const isAction = text.startsWith('\x01ACTION ') && text.endsWith('\x01')
  const content = isAction ? text.slice(8, -1) : text

  // Determine the "channel" for display purposes
  // If target is our nick, it's a PM — use the sender's nick as the channel key
  const isPrivate = target.toLowerCase() === client.state.nick.toLowerCase()
  const channel = isPrivate ? nick : target

  // Extract relevant tags
  const msgid = typeof msg.tags['msgid'] === 'string' ? msg.tags['msgid'] : undefined
  const time = typeof msg.tags['time'] === 'string' ? msg.tags['time'] : new Date().toISOString()
  const account = typeof msg.tags['account'] === 'string' ? msg.tags['account'] : undefined
  const replyTo = typeof msg.tags['+reply'] === 'string' ? msg.tags['+reply'] : undefined
  const label = typeof msg.tags['label'] === 'string' ? msg.tags['label'] : undefined
  const editOf = typeof msg.tags['+draft/edit'] === 'string' ? msg.tags['+draft/edit'] : undefined

  // Check if this is an echo of our own message
  const isEcho = nick.toLowerCase() === client.state.nick.toLowerCase()

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
    userHost: msg.source
      ? `${msg.source.user || ''}@${msg.source.host || ''}`
      : null,
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

  // Filter out CTCP replies (wrapped in \x01)
  if (text.startsWith('\x01') && text.endsWith('\x01')) {
    return
  }

  const isPrivate =
    target.toLowerCase() === client.state.nick.toLowerCase() || target === '*'
  const channel = isPrivate ? nick : target

  const msgid = typeof msg.tags['msgid'] === 'string' ? msg.tags['msgid'] : undefined
  const time = typeof msg.tags['time'] === 'string' ? msg.tags['time'] : new Date().toISOString()

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

  const isPrivate = target.toLowerCase() === client.state.nick.toLowerCase()
  const channel = isPrivate ? nick : target

  // Handle typing notifications (skip our own echoed typing)
  const typing = msg.tags['+typing']
  if (typeof typing === 'string') {
    if (nick.toLowerCase() !== client.state.nick.toLowerCase()) {
      client.events.emit('typing', {
        channel,
        nick,
        status: typing as 'active' | 'paused' | 'done'
      })
    }
    return
  }

  // Handle reactions
  const react = msg.tags['+draft/react']
  const replyTo = msg.tags['+reply']
  if (typeof react === 'string' && typeof replyTo === 'string') {
    client.events.emit('react', {
      channel,
      nick,
      emoji: react,
      msgid: replyTo
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
