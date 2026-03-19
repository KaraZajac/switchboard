import { registerHandler } from '../handlers/registry'

/**
 * draft/channel-rename — Handle channel renames.
 * :server RENAME <oldchan> <newchan> [reason]
 */
registerHandler('RENAME', (client, msg) => {
  const oldName = msg.params[0]
  const newName = msg.params[1]
  const reason = msg.params[2] || null

  // Update channel state
  const ch = client.state.channels.get(oldName.toLowerCase())
  if (ch) {
    client.state.channels.delete(oldName.toLowerCase())
    ch.name = newName
    client.state.channels.set(newName.toLowerCase(), ch)
  }

  client.events.emit('channelRename', { oldName, newName, reason })
})
