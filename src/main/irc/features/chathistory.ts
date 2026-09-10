import { isupportNumber } from '@shared/isupport'
import { registerHandler } from '../handlers/registry'

/**
 * draft/chathistory — Server-side message history.
 *
 * Commands:
 *   CHATHISTORY BEFORE <target> <msgid|timestamp> <limit>
 *   CHATHISTORY AFTER <target> <msgid|timestamp> <limit>
 *   CHATHISTORY LATEST <target> * <limit>
 *   CHATHISTORY AROUND <target> <msgid|timestamp> <limit>
 *   CHATHISTORY BETWEEN <target> <start> <end> <limit>
 *   CHATHISTORY TARGETS <from> <to> <limit>
 *
 * Responses come as a chathistory batch containing PRIVMSG/NOTICE messages.
 */

/**
 * The limit the server will honour.
 *
 * `CHATHISTORY=200` in ISUPPORT is the most it will return in one go. Asking
 * for more is not an error and not more history — it is the server quietly
 * doing something else with the request, so the page size the caller believes
 * in and the one it gets stop matching.
 */
function allowedLimit(
  state: { isupport: Record<string, string | true> },
  wanted: number
): number {
  const most = isupportNumber(state.isupport, 'CHATHISTORY')
  return most === null ? wanted : Math.min(wanted, most)
}

export function requestChathistory(
  client: {
    connection: { send: (...args: string[]) => void }
    state: { capabilities: Set<string>; isupport: Record<string, string | true> }
  },
  target: string,
  options: {
    direction?: 'BEFORE' | 'AFTER' | 'LATEST' | 'AROUND'
    reference?: string // msgid= or timestamp=
    limit?: number
  } = {}
): boolean {
  if (!client.state.capabilities.has('draft/chathistory')) {
    return false
  }

  const direction = options.direction || 'LATEST'
  const limit = allowedLimit(client.state, options.limit || 50)
  const reference = options.reference || '*'

  client.connection.send('CHATHISTORY', direction, target, reference, limit.toString())
  return true
}

/**
 * Request history between two timestamps.
 */
export function requestChathistoryBetween(
  client: {
    connection: { send: (...args: string[]) => void }
    state: { capabilities: Set<string>; isupport: Record<string, string | true> }
  },
  target: string,
  start: string,
  end: string,
  limit = 50
): boolean {
  if (!client.state.capabilities.has('draft/chathistory')) {
    return false
  }

  client.connection.send(
    'CHATHISTORY',
    'BETWEEN',
    target,
    start,
    end,
    allowedLimit(client.state, limit).toString()
  )
  return true
}

/**
 * Request list of conversation targets.
 */
export function requestChathistoryTargets(
  client: {
    connection: { send: (...args: string[]) => void }
    state: { capabilities: Set<string>; isupport: Record<string, string | true> }
  },
  from: string,
  to: string,
  limit = 50
): boolean {
  if (!client.state.capabilities.has('draft/chathistory')) {
    return false
  }

  client.connection.send(
    'CHATHISTORY',
    'TARGETS',
    from,
    to,
    allowedLimit(client.state, limit).toString()
  )
  return true
}

/**
 * The reply to CHATHISTORY TARGETS.
 *
 * `CHATHISTORY TARGETS <target> <timestamp>`, one line per conversation that
 * had traffic in the window, inside a batch. It is the only way to find out
 * that somebody messaged you while this device was closed: a DM from a stranger
 * creates no channel, sends no JOIN and leaves nothing behind for a client that
 * was not connected to notice.
 */
registerHandler('CHATHISTORY', (client, msg) => {
  if ((msg.params[0] ?? '').toUpperCase() !== 'TARGETS') return

  const target = msg.params[1]
  const timestamp = msg.params[2]
  if (!target || !timestamp) return

  client.events.emit('chathistoryTarget', { target, timestamp })
})
