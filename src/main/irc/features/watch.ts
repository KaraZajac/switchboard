import { registerHandler } from '../handlers/registry'

/**
 * WATCH — the older way of being told when someone turns up.
 *
 * bahamut, plexus and UnrealIRCd have had this since before IRCv3 specified
 * MONITOR, and the networks built on them still only offer WATCH: DALnet and
 * Rizon among them. Switchboard spoke only MONITOR, so on those networks the
 * friend list was a screen you could add names to that would never once tell
 * you anything.
 *
 * The replies are shaped differently — a nick, user and host as separate
 * parameters rather than a packed list — but they say the same two things, so
 * they land on the same events and nothing above this layer knows which
 * command was used.
 *
 * RPL_LOGON (600) — someone on the list just arrived
 * RPL_LOGOFF (601) — someone on the list just left
 * RPL_WATCHOFF (602) — we stopped watching someone
 * RPL_NOWON (604) — someone on the list is here, in answer to WATCH L
 * RPL_NOWOFF (605) — someone on the list is not, in answer to WATCH L
 * RPL_WATCHLIST (606) — the list itself
 * RPL_ENDOFWATCHLIST (607) — end of it
 * ERR_TOOMANYWATCH (512) — the list is full
 */

/** `<client> <nick> <user> <host> <when> :<text>` */
function arrival(msg: { params: string[] }): { nick: string; user: string | null; host: string | null } {
  return {
    nick: msg.params[1] || '',
    user: msg.params[2] || null,
    host: msg.params[3] || null
  }
}

for (const online of ['600', '604']) {
  registerHandler(online, (client, msg) => {
    const who = arrival(msg)
    if (who.nick) client.events.emit('monitorOnline', who)
  })
}

for (const offline of ['601', '605']) {
  registerHandler(offline, (client, msg) => {
    const nick = msg.params[1] || ''
    if (nick) client.events.emit('monitorOffline', { nick })
  })
}

registerHandler('606', (client, msg) => {
  // The list arrives as one space-separated trailing parameter, and on some
  // servers across several lines of it.
  const nicks = (msg.params[msg.params.length - 1] || '').split(' ').filter(Boolean)
  client.events.emit('monitorList', { nicks })
})

registerHandler('607', (client, _msg) => {
  client.events.emit('monitorListEnd', {})
})

registerHandler('512', (client, msg) => {
  client.events.emit('error', {
    code: '512',
    command: 'WATCH',
    message: msg.params[msg.params.length - 1] || 'Watch list is full'
  })
})
