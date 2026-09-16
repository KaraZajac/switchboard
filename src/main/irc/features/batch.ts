import { registerHandler } from '../handlers/registry'
import { dispatchMessage } from '../handlers/registry'
import { MAX_BATCH_MESSAGES } from '@shared/constants'
import type { IRCMessage, IRCBatch } from '@shared/types/irc'

/**
 * BATCH — Group related messages together.
 *
 * BATCH +<ref> <type> [params...]   — Start batch
 * @batch=<ref> <message>            — Message within batch
 * BATCH -<ref>                      — End batch
 *
 * Batches can be nested. We defer processing until the batch closes.
 */

registerHandler('BATCH', (client, msg) => {
  const ref = msg.params[0]

  if (ref.startsWith('+')) {
    // Start a new batch
    const batchId = ref.slice(1)
    const type = msg.params[1] || ''
    const params = msg.params.slice(2)

    // Check for parent batch
    const parentBatchTag = msg.tags['batch']
    const parent = typeof parentBatchTag === 'string' ? parentBatchTag : null

    const batch: IRCBatch = {
      id: batchId,
      type,
      params,
      messages: [],
      parent,
      tags: msg.tags
    }

    client.state.batches.set(batchId, batch)
  } else if (ref.startsWith('-')) {
    // End of batch
    const batchId = ref.slice(1)
    const batch = client.state.batches.get(batchId)
    if (!batch) return

    client.state.batches.delete(batchId)

    // If this batch has a parent, add it to the parent instead
    if (batch.parent) {
      const parentBatch = client.state.batches.get(batch.parent)
      if (parentBatch) {
        // Store nested batch info — parent will handle when it closes
        return
      }
    }

    // Process the completed batch
    processBatch(client, batch)
  }
})

/**
 * Batch types whose contents must not be treated as live traffic.
 *
 * These are the ones where the batch changes what the messages *mean*: history
 * is not news, a netsplit is one event rather than fifty quits, and the parts
 * of a multiline message are not separate messages. Every other type — `names`,
 * `metadata`, `labeled-response` — is a grouping hint, and the batch spec says
 * a client that has nothing special to do with a type should process its
 * messages as if they had arrived unbatched.
 */
const DEFERRED_BATCH_TYPES = new Set([
  'chathistory',
  'draft/chathistory',
  'netsplit',
  'netjoin',
  'draft/multiline',
  'multiline',
  'search',
  'draft/search'
])

/**
 * Buffer a message that belongs to a batch we handle ourselves.
 *
 * Returns true when the message has been consumed and must not be dispatched.
 *
 * Getting this wrong is not subtle. A replayed JOIN handled as a live one sends
 * NAMES, a metadata sync, a WHO and another CHATHISTORY — whose reply replays
 * the same JOIN again. The client floods itself in a loop it cannot see.
 */
export function checkBatchMembership(
  client: {
    state: { batches: Map<string, IRCBatch> }
    events?: { emit: (name: string, data: unknown) => void }
  },
  msg: IRCMessage
): boolean {
  const batchTag = msg.tags['batch']
  if (typeof batchTag !== 'string') return false

  const batch = client.state.batches.get(batchTag)
  if (!batch) return false

  // Only collect what we are going to do something with. A nested batch
  // inherits its ancestor's meaning: replayed history is still history.
  if (!isDeferred(client, batch)) return false

  batch.messages.push(msg)

  // A batch is a promise that an end is coming. One that never closes, or
  // closes after a million lines, was this client growing without limit —
  // and it is still "consumed", because the alternative is dispatching the
  // overflow live, which is the loop this function exists to prevent.
  if (batch.messages.length > MAX_BATCH_MESSAGES) {
    abandonBatch(client, batchTag)
    client.events?.emit('error', {
      code: 'BATCH',
      command: 'BATCH',
      message: `Gave up on a batch after ${MAX_BATCH_MESSAGES} messages — the server never ended it`
    })
  }
  return true
}

/** Drop a batch and everything nested inside it, unprocessed */
function abandonBatch(client: { state: { batches: Map<string, IRCBatch> } }, id: string): void {
  client.state.batches.delete(id)
  for (const [childId, child] of client.state.batches) {
    if (child.parent === id) abandonBatch(client, childId)
  }
}

function isDeferred(
  client: { state: { batches: Map<string, IRCBatch> } },
  batch: IRCBatch
): boolean {
  const seen = new Set<string>()
  let current: IRCBatch | undefined = batch

  while (current && !seen.has(current.id)) {
    if (DEFERRED_BATCH_TYPES.has(current.type)) return true
    seen.add(current.id)
    current = current.parent ? client.state.batches.get(current.parent) : undefined
  }
  return false
}

/**
 * The parts of a multiline message, as the one message they were.
 *
 * Exported because this is the rule the shared corpus pins, and pinning a copy
 * of it in the test would pass whether or not this is what runs.
 */
export function combineMultiline(
  parts: { tags?: Record<string, string | true>; params: string[] }[]
): string {
  let text = ''
  parts.forEach((part, at) => {
    if (at > 0 && part.tags?.['draft/multiline-concat'] === undefined) text += '\n'
    text += part.params[1] || ''
  })
  return text
}

/** What `processBatch` needs of a client: an emitter and the rosters */
interface BatchClient {
  events: { emit: (event: string, ...args: unknown[]) => boolean }
  state?: {
    channels: Map<
      string,
      {
        name: string
        users: Map<string, unknown>
        setUser: (nick: string, data: { nick: string }) => unknown
        removeUser: (nick: string) => void
      }
    >
    casemap(name: string): string
  }
}

/**
 * Say the roster changed, so the window redraws it.
 *
 * The member list is drawn from `names` and nothing else — the same reason the
 * `MODE` handler emits one.
 */
function redraw(client: BatchClient, channels: Iterable<{ name: string; users: Map<string, unknown> }>): void {
  for (const channel of channels) {
    client.events.emit('names', { channel: channel.name, users: [...channel.users.values()] })
  }
}

/**
 * Process a completed batch based on its type.
 */
function processBatch(client: BatchClient, batch: IRCBatch): void {
  switch (batch.type) {
    case 'chathistory':
      // History replay — emit messages in order
      client.events.emit('chathistoryBatch', {
        target: batch.params[0] || '',
        messages: batch.messages
      })
      break

    case 'netsplit': {
      // Collapse QUIT messages into a single event.
      //
      // The quits themselves were never dispatched — that is the point of
      // deferring the batch — so the roster has to be told here or the fifty
      // people who just left go on standing in the member list. The phone has
      // always done this half.
      const quits = batch.messages.map((m) => ({
        nick: m.source?.nick || '',
        reason: m.params[0] || ''
      }))

      const emptied = new Set<{ name: string; users: Map<string, unknown> }>()
      for (const channel of client.state?.channels.values() ?? []) {
        for (const { nick } of quits) {
          if (!nick) continue
          const before = channel.users.size
          channel.removeUser(nick)
          if (channel.users.size !== before) emptied.add(channel)
        }
      }

      client.events.emit('netsplit', {
        server1: batch.params[0] || '',
        server2: batch.params[1] || '',
        quits
      })
      redraw(client, emptied)
      break
    }

    case 'netjoin': {
      // Collapse JOIN messages into a single event.
      //
      // And put them back, for the same reason: the split took them out of the
      // roster and nothing else is going to say they returned. Without this the
      // member list only ever shrinks across a split, and stays short until the
      // channel is rejoined.
      const joins = batch.messages.map((m) => ({
        nick: m.source?.nick || '',
        channel: m.params[0] || ''
      }))

      const filled = new Set<{ name: string; users: Map<string, unknown> }>()
      for (const { nick, channel } of joins) {
        if (!nick || !channel) continue
        const ch = client.state?.channels.get(client.state.casemap(channel))
        if (!ch) continue
        ch.setUser(nick, { nick })
        filled.add(ch)
      }

      client.events.emit('netjoin', {
        server1: batch.params[0] || '',
        server2: batch.params[1] || '',
        joins
      })
      redraw(client, filled)
      break
    }

    case 'draft/multiline':
    case 'multiline': {
      // One message that was split across several lines, put back together.
      //
      // A part tagged `draft/multiline-concat` continues the one before it with
      // no line break: it is how a sender says "this was one long line the
      // protocol made me split". Joining everything with a newline instead puts
      // breaks in the middle of their sentence.
      const target = batch.params[0] || ''
      const parts = batch.messages.filter((m) => m.command === 'PRIVMSG')
      if (parts.length === 0) break

      // The message's own tags are on the BATCH line, not on its parts: that
      // is where the spec puts msgid, time and account for the whole. Built
      // from the first part alone, the message got an invented id — and an
      // edit, a reaction or a deletion naming the real one found nothing,
      // on this client and on the phone alike.
      const { batch: _outer, ...opening } = batch.tags ?? {}
      const { batch: _inner, ...own } = parts[0].tags
      void _outer
      void _inner
      const tags = { ...opening, ...own }

      dispatchMessage(client, { ...parts[0], tags, params: [target, combineMultiline(parts)] })
      break
    }

    case 'search':
      // Server-side search results — emit as a batch
      client.events.emit('searchResults', { messages: batch.messages })
      break

    default:
      // Everything else — `names`, `metadata`, `labeled-response`, a type we
      // have never heard of — was handled as it arrived, which is what the
      // batch spec asks of a client with nothing special to do with the type.
      // Nothing was collected, so there is nothing to replay: dispatching here
      // would deliver every message a second time.
      break
  }
}
