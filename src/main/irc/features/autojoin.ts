import { registerHandler } from '../handlers/registry'

/**
 * draft/auto-join — Server-provided auto-join channel list.
 *
 * After registration, the server sends one or more AUTOJOIN messages
 * with comma-separated channel names. We collect them and issue a
 * single JOIN once we see the first non-AUTOJOIN message.
 */

interface Pending {
  channels: string[]
  timer: ReturnType<typeof setTimeout> | null
}

// Per connection. Kept at module level, two networks sending AUTOJOIN in the
// same half-second — which is what connecting to both at launch looks like —
// pooled their channels and sent the lot to whichever answered last.
const pending = new WeakMap<object, Pending>()

registerHandler('AUTOJOIN', (client, msg) => {
  if (!client.state.capabilities.has('draft/auto-join')) return

  let mine = pending.get(client)
  if (!mine) {
    mine = { channels: [], timer: null }
    pending.set(client, mine)
  }
  const channelList = msg.params[0] || ''
  for (const ch of channelList.split(',')) {
    const trimmed = ch.trim()
    if (trimmed) mine.channels.push(trimmed)
  }

  // Use a short delay to collect multiple AUTOJOIN messages before joining
  if (mine.timer) clearTimeout(mine.timer)
  mine.timer = setTimeout(() => {
    pending.delete(client)
    // Filter out channels we're already in
    const toJoin = mine.channels.filter(
      (ch) => !client.state.channels.has(client.state.casemap(ch))
    )
    if (toJoin.length > 0) {
      client.connection.send('JOIN', toJoin.join(','))
    }
  }, 500)
})
