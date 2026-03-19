import { registerHandler } from './registry'

/**
 * RPL_WHOISUSER (311)
 */
registerHandler('311', (client, msg) => {
  // params: <nick> <target> <user> <host> * :<realname>
  const nick = msg.params[1]
  client.state.whoisData = {
    nick,
    user: msg.params[2] || '',
    host: msg.params[3] || '',
    realname: msg.params[5] || ''
  }
})

/**
 * RPL_WHOISSERVER (312)
 */
registerHandler('312', (client, msg) => {
  if (client.state.whoisData) {
    client.state.whoisData.server = msg.params[2] || ''
    client.state.whoisData.serverInfo = msg.params[3] || ''
  }
})

/**
 * RPL_WHOISOPERATOR (313)
 */
registerHandler('313', (client, _msg) => {
  if (client.state.whoisData) {
    client.state.whoisData.operator = 'true'
  }
})

/**
 * RPL_WHOISIDLE (317)
 */
registerHandler('317', (client, msg) => {
  if (client.state.whoisData) {
    client.state.whoisData.idle = msg.params[2] || ''
    client.state.whoisData.signon = msg.params[3] || ''
  }
})

/**
 * RPL_WHOISCHANNELS (319)
 */
registerHandler('319', (client, msg) => {
  if (client.state.whoisData) {
    client.state.whoisData.channels = msg.params[2] || ''
  }
})

/**
 * RPL_WHOISACCOUNT (330) — Logged-in account name
 */
registerHandler('330', (client, msg) => {
  if (client.state.whoisData) {
    client.state.whoisData.account = msg.params[2] || ''
  }
})

/**
 * RPL_WHOISBOT (335) — Bot flag
 */
registerHandler('335', (client, _msg) => {
  if (client.state.whoisData) {
    client.state.whoisData.bot = 'true'
  }
})

/**
 * RPL_ENDOFWHOIS (318) — End of WHOIS
 */
registerHandler('318', (client, _msg) => {
  if (client.state.whoisData) {
    client.events.emit('whois', { ...client.state.whoisData })
    client.state.whoisData = null
  }
})
