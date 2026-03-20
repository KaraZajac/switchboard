
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

export function requestChathistory(
  client: {
    connection: { send: (...args: string[]) => void }
    state: { capabilities: Set<string> }
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
  const limit = options.limit || 50
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
    state: { capabilities: Set<string> }
  },
  target: string,
  start: string,
  end: string,
  limit = 50
): boolean {
  if (!client.state.capabilities.has('draft/chathistory')) {
    return false
  }

  client.connection.send('CHATHISTORY', 'BETWEEN', target, start, end, limit.toString())
  return true
}

/**
 * Request list of conversation targets.
 */
export function requestChathistoryTargets(
  client: {
    connection: { send: (...args: string[]) => void }
    state: { capabilities: Set<string> }
  },
  from: string,
  to: string,
  limit = 50
): boolean {
  if (!client.state.capabilities.has('draft/chathistory')) {
    return false
  }

  client.connection.send('CHATHISTORY', 'TARGETS', from, to, limit.toString())
  return true
}
