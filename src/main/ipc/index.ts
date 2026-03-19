import { ipcMain } from 'electron'
import { ircManager } from '../irc/manager'
import {
  getAllServers,
  getServer,
  addServer,
  updateServer,
  removeServer
} from '../storage/models/server'
import { getMessages } from '../storage/models/message'
import { getSetting, setSetting } from '../storage/models/settings'

/**
 * Register all IPC handlers.
 * These handle renderer → main invocations.
 */
export function registerIPCHandlers(): void {
  // ── Server management ────────────────────────────────────────────

  ipcMain.handle('server:list', async () => {
    return getAllServers()
  })

  ipcMain.handle('server:add', async (_event, config) => {
    const id = addServer(config)
    return id
  })

  ipcMain.handle('server:update', async (_event, serverId: string, updates) => {
    updateServer(serverId, updates)
  })

  ipcMain.handle('server:remove', async (_event, serverId: string) => {
    ircManager.disconnect(serverId)
    removeServer(serverId)
  })

  ipcMain.handle('server:connect', async (_event, serverId: string) => {
    const config = getServer(serverId)
    if (!config) throw new Error(`Server ${serverId} not found`)
    ircManager.connect(config)
  })

  ipcMain.handle('server:disconnect', async (_event, serverId: string) => {
    ircManager.disconnect(serverId)
  })

  // ── Channel operations ───────────────────────────────────────────

  ipcMain.handle('channel:join', async (_event, serverId: string, channel: string, key?: string) => {
    const client = ircManager.getClient(serverId)
    if (!client) throw new Error('Not connected')
    client.join(channel, key)
  })

  ipcMain.handle('channel:part', async (_event, serverId: string, channel: string) => {
    const client = ircManager.getClient(serverId)
    if (!client) throw new Error('Not connected')
    client.part(channel)
  })

  ipcMain.handle('channel:topic', async (_event, serverId: string, channel: string, topic: string) => {
    const client = ircManager.getClient(serverId)
    if (!client) throw new Error('Not connected')
    client.setTopic(channel, topic)
  })

  // ── Message operations ───────────────────────────────────────────

  ipcMain.handle('message:send', async (_event, serverId: string, channel: string, text: string) => {
    const client = ircManager.getClient(serverId)
    if (!client) throw new Error('Not connected')

    // Handle /me action
    if (text.startsWith('/me ')) {
      client.action(channel, text.slice(4))
    } else {
      client.say(channel, text)
    }
  })

  ipcMain.handle('message:reply', async (_event, serverId: string, channel: string, text: string, replyTo: string) => {
    const client = ircManager.getClient(serverId)
    if (!client) throw new Error('Not connected')
    // Send with +reply tag if echo-message is supported
    client.connection.sendRaw(
      `@+reply=${replyTo} PRIVMSG ${channel} :${text}`
    )
  })

  ipcMain.handle('message:react', async (_event, serverId: string, channel: string, msgid: string, emoji: string) => {
    const client = ircManager.getClient(serverId)
    if (!client) throw new Error('Not connected')
    client.connection.sendRaw(
      `@+draft/react=${emoji};+reply=${msgid} TAGMSG ${channel}`
    )
  })

  ipcMain.handle('message:redact', async (_event, serverId: string, channel: string, msgid: string, reason?: string) => {
    const client = ircManager.getClient(serverId)
    if (!client) throw new Error('Not connected')
    if (reason) {
      client.connection.send('REDACT', channel, msgid, reason)
    } else {
      client.connection.send('REDACT', channel, msgid)
    }
  })

  ipcMain.handle('message:typing', async (_event, serverId: string, channel: string) => {
    const client = ircManager.getClient(serverId)
    if (!client) throw new Error('Not connected')
    client.connection.sendRaw(`@+typing=active TAGMSG ${channel}`)
  })

  // ── User operations ──────────────────────────────────────────────

  ipcMain.handle('user:whois', async (_event, serverId: string, nick: string) => {
    const client = ircManager.getClient(serverId)
    if (!client) throw new Error('Not connected')
    client.whois(nick)
    // Result comes back as irc:whois event
    return {}
  })

  ipcMain.handle('user:kick', async (_event, serverId: string, channel: string, nick: string, reason?: string) => {
    const client = ircManager.getClient(serverId)
    if (!client) throw new Error('Not connected')
    client.kick(channel, nick, reason)
  })

  // ── History ──────────────────────────────────────────────────────

  ipcMain.handle('history:fetch', async (_event, serverId: string, channel: string, before?: string, limit?: number) => {
    return getMessages(serverId, channel, { before, limit })
  })

  // ── Settings ─────────────────────────────────────────────────────

  ipcMain.handle('settings:get', async (_event, key: string) => {
    return getSetting(key)
  })

  ipcMain.handle('settings:set', async (_event, key: string, value: unknown) => {
    setSetting(key, value)
  })

  // ── Read markers ─────────────────────────────────────────────────

  ipcMain.handle('read-marker:set', async (_event, serverId: string, channel: string, timestamp: string) => {
    const client = ircManager.getClient(serverId)
    if (client && client.state.capabilities.has('draft/read-marker')) {
      client.connection.send('MARKREAD', channel, `timestamp=${timestamp}`)
    }
  })
}
