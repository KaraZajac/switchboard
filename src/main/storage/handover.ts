import { storeMessage } from './models/message'
import { getServer } from './models/server'
import type { ChatMessage } from '@shared/types/message'
import type { HandoverMessage } from '@shared/types/ipc'

/**
 * Messages the phone took while it was the connection.
 *
 * The phone has no database — its store is what is on screen, and it is gone
 * when Android stops the process. So a night when the desktop was off used to
 * end with those messages nowhere: the phone showed them until it restarted,
 * and this machine had a gap it could only fill from the network, with
 * `chathistory` on the servers that have it and nothing at all on the ones
 * that do not.
 *
 * So the phone hands them over when the two are next in touch. Everything
 * here is somebody else's word for what happened, which is why none of it is
 * trusted blindly: the server has to be one we know, the shape has to be
 * right, and a batch is capped. Writing is `INSERT OR IGNORE` on the message
 * id, so a batch that arrives twice — a flush that raced a reconnect, a phone
 * that did not hear the answer — costs a few wasted inserts and changes
 * nothing.
 */

/** Most a single hand-over may carry, so a bad peer cannot ask for the world */
export const HANDOVER_LIMIT = 500

/** The tags the phone knows about, put back the way the rest of the app reads them */
function tagsFrom(entry: HandoverMessage): Record<string, string> {
  const tags: Record<string, string> = {}
  if (entry.oper) tags['draft/oper'] = entry.oper
  if (entry.relayedBy) tags['draft/relaymsg'] = entry.relayedBy
  if (entry.replyTo) tags['+draft/reply'] = entry.replyTo
  return tags
}

/** Whether this is a message rather than whatever else came down the wire */
function usable(entry: unknown): entry is HandoverMessage {
  if (!entry || typeof entry !== 'object') return false
  const row = entry as Record<string, unknown>
  return (
    typeof row.id === 'string' &&
    row.id.length > 0 &&
    typeof row.channel === 'string' &&
    row.channel.length > 0 &&
    typeof row.content === 'string' &&
    typeof row.timestamp === 'string' &&
    row.timestamp.length > 0
  )
}

/**
 * Write what the phone handed over, and say how much of it was new to us.
 *
 * Returns the number stored rather than the number sent: the caller logs it,
 * and "47 of 300 were new" is the useful half of that sentence.
 */
export function storeHandover(serverId: string, entries: unknown[]): number {
  if (!getServer(serverId)) {
    // A network this desktop does not have. Not an error — the phone may have
    // been given one while we were away — but not something to write rows for
    // either, because nothing here could ever show them.
    return 0
  }

  let stored = 0
  for (const entry of entries.slice(0, HANDOVER_LIMIT)) {
    if (!usable(entry)) continue

    const row: Omit<ChatMessage, 'pending' | 'reactions'> = {
      id: entry.id,
      serverId,
      channel: entry.channel,
      nick: typeof entry.nick === 'string' ? entry.nick : '',
      userHost: null,
      content: entry.content,
      type: entry.type ?? 'privmsg',
      tags: tagsFrom(entry),
      replyTo: entry.replyTo ?? null,
      timestamp: entry.timestamp,
      account: entry.account ?? null,
      channelContext: null
    }

    try {
      storeMessage(row)
      stored++
    } catch (err) {
      // One bad row is not a reason to drop the rest of the night
      console.error('Could not store a handed-over message:', err)
    }
  }

  return stored
}
