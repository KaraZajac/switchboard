import { registerHandler } from '../handlers/registry'
import { dispatchMessage } from '../handlers/registry'
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
      parent
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
 * Check if a message belongs to a batch and buffer it.
 * Returns true if the message was consumed by a batch.
 */
export function checkBatchMembership(
  client: { state: { batches: Map<string, IRCBatch> } },
  msg: IRCMessage
): boolean {
  const batchTag = msg.tags['batch']
  if (typeof batchTag !== 'string') return false

  const batch = client.state.batches.get(batchTag)
  if (batch) {
    batch.messages.push(msg)
    return true
  }
  return false
}

/**
 * Process a completed batch based on its type.
 */
function processBatch(client: { events: { emit: (event: string, ...args: unknown[]) => boolean } }, batch: IRCBatch): void {
  switch (batch.type) {
    case 'chathistory':
      // History replay — emit messages in order
      client.events.emit('chathistoryBatch', {
        target: batch.params[0] || '',
        messages: batch.messages
      })
      break

    case 'netsplit':
      // Collapse QUIT messages into a single event
      client.events.emit('netsplit', {
        server1: batch.params[0] || '',
        server2: batch.params[1] || '',
        quits: batch.messages.map((m) => ({
          nick: m.source?.nick || '',
          reason: m.params[0] || ''
        }))
      })
      break

    case 'netjoin':
      // Collapse JOIN messages into a single event
      client.events.emit('netjoin', {
        server1: batch.params[0] || '',
        server2: batch.params[1] || '',
        joins: batch.messages.map((m) => ({
          nick: m.source?.nick || '',
          channel: m.params[0] || ''
        }))
      })
      break

    case 'draft/multiline': {
      // Concatenate all PRIVMSG content into a single message
      const target = batch.params[0] || ''
      const multilineMessages = batch.messages.filter((m) => m.command === 'PRIVMSG')
      if (multilineMessages.length > 0) {
        const combinedContent = multilineMessages.map((m) => m.params[1] || '').join('\n')
        // Create a synthetic message with combined content
        const first = multilineMessages[0]
        const syntheticMsg = { ...first, params: [target, combinedContent] }
        dispatchMessage(client, syntheticMsg)
      }
      break
    }

    case 'search':
      // Server-side search results — emit as a batch
      client.events.emit('searchResults', { messages: batch.messages })
      break

    case 'labeled-response':
      // Labeled response — process contained messages normally
      // The label tag on individual messages correlates request/response
      for (const msg of batch.messages) {
        // Re-dispatch each message through the handler system
        dispatchMessage(client, msg)
      }
      break

    default:
      // Unknown batch type — process messages normally
      for (const msg of batch.messages) {
        dispatchMessage(client, msg)
      }
      break
  }
}
