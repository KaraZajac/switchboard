import { registerHandler } from '../handlers/registry'

/**
 * draft/auto-join — Server-provided auto-join channel list.
 *
 * After registration, the server sends one or more AUTOJOIN messages
 * with comma-separated channel names. We collect them and issue a
 * single JOIN once we see the first non-AUTOJOIN message.
 */

let pendingChannels: string[] = []
let flushTimer: ReturnType<typeof setTimeout> | null = null

registerHandler('AUTOJOIN', (client, msg) => {
  if (!client.state.capabilities.has('draft/auto-join')) return

  const channelList = msg.params[0] || ''
  for (const ch of channelList.split(',')) {
    const trimmed = ch.trim()
    if (trimmed) pendingChannels.push(trimmed)
  }

  // Use a short delay to collect multiple AUTOJOIN messages before joining
  if (flushTimer) clearTimeout(flushTimer)
  flushTimer = setTimeout(() => {
    if (pendingChannels.length > 0) {
      // Filter out channels we're already in
      const toJoin = pendingChannels.filter(
        (ch) => !client.state.channels.has(ch.toLowerCase())
      )
      if (toJoin.length > 0) {
        client.connection.send('JOIN', toJoin.join(','))
      }
      pendingChannels = []
    }
    flushTimer = null
  }, 500)
})
