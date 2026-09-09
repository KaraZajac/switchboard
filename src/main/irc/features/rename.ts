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
  const ch = client.state.channels.get(client.state.casemap(oldName))
  if (ch) {
    client.state.channels.delete(client.state.casemap(oldName))
    ch.name = newName
    client.state.channels.set(client.state.casemap(newName), ch)
  }

  client.events.emit('channelRename', { oldName, newName, reason })
})
