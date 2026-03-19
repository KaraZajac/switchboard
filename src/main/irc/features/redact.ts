import { registerHandler } from '../handlers/registry'

/**
 * draft/message-redaction — Delete/redact messages.
 * :nick!user@host REDACT <target> <msgid> [reason]
 */
registerHandler('REDACT', (client, msg) => {
  const target = msg.params[0]
  const msgid = msg.params[1]
  const reason = msg.params[2] || null
  const nick = msg.source?.nick || ''

  client.events.emit('redact', { channel: target, msgid, nick, reason })
})
