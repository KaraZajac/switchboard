import { registerHandler } from './registry'

/**
 * ERROR — Server-side error (usually before disconnect)
 */
registerHandler('ERROR', (client, msg) => {
  const message = msg.params[0] || 'Unknown error'
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

/** ERR_NOSUCHCHANNEL (403) */
registerHandler('403', (client, msg) => {
  client.events.emit('error', {
    code: '403',
    command: msg.params[1] || '',
    message: msg.params[2] || 'No such channel'
  })
})

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
registerHandler('442', (client, msg) => {
  client.events.emit('error', {
    code: '442',
    command: msg.params[1] || '',
    message: msg.params[2] || "You're not on that channel"
  })
})

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

/** ERR_BANNEDFROMCHAN (474) */
registerHandler('474', (client, msg) => {
  client.events.emit('error', {
    code: '474',
    command: msg.params[1] || '',
    message: msg.params[2] || 'Cannot join channel (+b)'
  })
})

/** ERR_INVITEONLYCHAN (473) */
registerHandler('473', (client, msg) => {
  client.events.emit('error', {
    code: '473',
    command: msg.params[1] || '',
    message: msg.params[2] || 'Cannot join channel (+i)'
  })
})

/** ERR_BADCHANNELKEY (475) */
registerHandler('475', (client, msg) => {
  client.events.emit('error', {
    code: '475',
    command: msg.params[1] || '',
    message: msg.params[2] || 'Cannot join channel (+k)'
  })
})

/** ERR_CHANNELISFULL (471) */
registerHandler('471', (client, msg) => {
  client.events.emit('error', {
    code: '471',
    command: msg.params[1] || '',
    message: msg.params[2] || 'Cannot join channel (+l)'
  })
})
