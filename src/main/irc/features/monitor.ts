import { registerHandler } from '../handlers/registry'

/**
 * MONITOR — Friend list / online notification system.
 *
 * RPL_MONONLINE (730) — Monitored nicks now online
 * RPL_MONOFFLINE (731) — Monitored nicks now offline
 * RPL_MONLIST (732) — Current monitor list
 * RPL_ENDOFMONLIST (733) — End of monitor list
 * ERR_MONLISTFULL (734) — Monitor list is full
 */

registerHandler('730', (client, msg) => {
  // params: <nick> :nick1!user@host,nick2!user@host,...
  const targets = parseMonitorTargets(msg.params[1] || '')
  for (const target of targets) {
    client.events.emit('monitorOnline', { nick: target.nick, user: target.user, host: target.host })
  }
})

registerHandler('731', (client, msg) => {
  // params: <nick> :nick1,nick2,...
  const nicks = (msg.params[1] || '').split(',').filter(Boolean)
  for (const nick of nicks) {
    client.events.emit('monitorOffline', { nick })
  }
})

registerHandler('732', (client, msg) => {
  // params: <nick> :nick1,nick2,...
  const nicks = (msg.params[1] || '').split(',').filter(Boolean)
  client.events.emit('monitorList', { nicks })
})

registerHandler('733', (client, _msg) => {
  client.events.emit('monitorListEnd', {})
})

registerHandler('734', (client, msg) => {
  // params: <nick> <limit> <nicks> :Monitor list is full
  const limit = parseInt(msg.params[1] || '0', 10)
  client.events.emit('error', {
    code: '734',
    command: 'MONITOR',
    message: `Monitor list is full (limit: ${limit})`
  })
})

function parseMonitorTargets(str: string): { nick: string; user: string | null; host: string | null }[] {
  return str.split(',').filter(Boolean).map((entry) => {
    const bangIdx = entry.indexOf('!')
    const atIdx = entry.indexOf('@')
    if (bangIdx !== -1 && atIdx !== -1) {
      return {
        nick: entry.slice(0, bangIdx),
        user: entry.slice(bangIdx + 1, atIdx),
        host: entry.slice(atIdx + 1)
      }
    }
    return { nick: entry, user: null, host: null }
  })
}
