import { registerHandler } from '../handlers/registry'

/**
 * draft/read-marker — Sync read position across devices.
 *
 * Client sends: MARKREAD <target> [timestamp=<ISO8601>]
 * Server sends: MARKREAD <target> timestamp=<ISO8601>
 *
 * With no `timestamp=` it is a question rather than an instruction, and the
 * answer is either a position or `*` for a conversation nobody has marked.
 */

registerHandler('MARKREAD', (client, msg) => {
  const target = msg.params[0]
  let timestamp: string | null = null

  // Parse timestamp= from params
  for (let i = 1; i < msg.params.length; i++) {
    if (msg.params[i].startsWith('timestamp=')) {
      timestamp = msg.params[i].slice('timestamp='.length)
    }
  }

  // `MARKREAD <target> *` says the server holds no position for this
  // conversation. Nothing to pass on, and passing the `*` on would read as a
  // timestamp above every real one — see `@shared/readmarker`. The bare form
  // is what the spec gives; `timestamp=*` is not, and means the same thing.
  if (target && timestamp && timestamp !== '*') {
    client.events.emit('readMarker', { channel: target, timestamp })
  }
})

/**
 * Ask where a conversation was read up to.
 *
 * Needed because a device only hears a marker it was present for. Open the
 * desktop after a week and it learns from `CHATHISTORY TARGETS` about every
 * conversation that had traffic — and about where any of them was read up to,
 * nothing at all, so a DM answered on the phone on Tuesday arrives here on
 * Friday with its badge lit.
 *
 * Servers are told to volunteer a marker for channels you join; nobody
 * volunteers one for a conversation you have not opened yet, and asking is
 * what the specification provides for. rIRCd answers `MARKREAD <target> *`
 * where it holds none, which is the right answer and costs nothing.
 */
export function requestReadMarker(
  client: {
    connection: { send: (...args: string[]) => void }
    state: { capabilities: Set<string> }
  },
  target: string
): boolean {
  if (!target) return false
  if (!client.state.capabilities.has('draft/read-marker')) return false

  client.connection.send('MARKREAD', target)
  return true
}
