import { ipcMain, Notification, app } from 'electron'
import { autoUpdater } from 'electron-updater'
import { ircManager } from '../irc/manager'
import {
  getAllServers,
  getServer,
  addServer,
  updateServer,
  removeServer
} from '../storage/models/server'
import { getMessages, searchMessages, deleteMessage } from '../storage/models/message'
import { getSetting, setSetting } from '../storage/models/settings'
import { getReadMarker, setReadMarker, getAllReadMarkers } from '../storage/models/readmarker'

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

  ipcMain.handle('channel:list', async (_event, serverId: string) => {
    const client = ircManager.getClient(serverId)
    if (!client) throw new Error('Not connected')

    return new Promise<{ name: string; userCount: number; topic: string }[]>((resolve) => {
      const timeout = setTimeout(() => {
        client.events.off('channelList', onList)
        resolve([])
      }, 15000)

      const onList = (channels: { name: string; userCount: number; topic: string }[]) => {
        clearTimeout(timeout)
        resolve(channels)
      }

      client.events.once('channelList', onList)
      client.connection.send('LIST')
    })
  })

  // ── Message operations ───────────────────────────────────────────

  ipcMain.handle('message:send', async (_event, serverId: string, channel: string, text: string) => {
    const client = ircManager.getClient(serverId)
    if (!client) throw new Error('Not connected')

    // Handle /me action
    if (text.startsWith('/me ')) {
      client.action(channel, text.slice(4))
    } else if (text.includes('\n') && client.state.capabilities.has('draft/multiline')) {
      // Multiline message — send as batch
      const { sendMultilineMessage } = await import('../irc/features/multiline')
      const lines = text.split('\n')
      sendMultilineMessage(client, channel, lines)
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

    // Delete from local database
    deleteMessage(msgid)

    // Send REDACT to the server
    if (reason) {
      client.connection.send('REDACT', channel, msgid, reason)
    } else {
      client.connection.send('REDACT', channel, msgid)
    }
  })

  ipcMain.handle('message:typing', async (_event, serverId: string, channel: string, status: 'active' | 'done' = 'active') => {
    const client = ircManager.getClient(serverId)
    if (!client) throw new Error('Not connected')
    client.connection.sendRaw(`@+typing=${status} TAGMSG ${channel}`)
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

  ipcMain.handle('user:nick', async (_event, serverId: string, nick: string) => {
    const client = ircManager.getClient(serverId)
    if (!client) throw new Error('Not connected')
    client.setNick(nick)
  })

  ipcMain.handle('user:setname', async (_event, serverId: string, realname: string) => {
    const client = ircManager.getClient(serverId)
    if (!client) throw new Error('Not connected')
    if (!client.state.capabilities.has('setname')) {
      throw new Error('Server does not support SETNAME')
    }
    client.connection.send('SETNAME', realname)
  })

  // ── Metadata ────────────────────────────────────────────────────

  ipcMain.handle('metadata:get', async (_event, serverId: string, target: string, key: string) => {
    const client = ircManager.getClient(serverId)
    if (!client) throw new Error('Not connected')
    if (!client.state.capabilities.has('draft/metadata-2')) {
      throw new Error('Server does not support metadata')
    }
    client.connection.send('METADATA', target, 'GET', key)
  })

  ipcMain.handle('metadata:set', async (_event, serverId: string, key: string, value: string) => {
    const client = ircManager.getClient(serverId)
    if (!client) throw new Error('Not connected')
    if (!client.state.capabilities.has('draft/metadata-2')) {
      throw new Error('Server does not support metadata')
    }
    // Use sendRaw to avoid the serializer adding a trailing ':' prefix
    // which some server implementations incorrectly store as part of the value
    if (value.includes(' ') || value.startsWith(':')) {
      client.connection.sendRaw(`METADATA * SET ${key} :${value}`)
    } else {
      client.connection.sendRaw(`METADATA * SET ${key} ${value}`)
    }
  })

  // ── History ──────────────────────────────────────────────────────

  ipcMain.handle('history:fetch', async (_event, serverId: string, channel: string, before?: string, limit?: number) => {
    return getMessages(serverId, channel, { before, limit })
  })

  ipcMain.handle('chathistory:request', async (_event, serverId: string, channel: string, before?: string, limit?: number) => {
    const client = ircManager.getClient(serverId)
    if (!client) return
    const { requestChathistory } = await import('../irc/features/chathistory')
    const reference = before ? `timestamp=${before}` : '*'
    requestChathistory(client, channel, {
      direction: before ? 'BEFORE' : 'LATEST',
      reference,
      limit: limit || 50
    })
  })

  // ── Account registration ────────────────────────────────────

  ipcMain.handle('account:register', async (_event, serverId: string, email: string | null, password: string) => {
    const client = ircManager.getClient(serverId)
    if (!client) throw new Error('Not connected')
    const { registerAccount } = await import('../irc/features/account-registration')
    return registerAccount(client, email, password)
  })

  // ── Search ──────────────────────────────────────────────────

  ipcMain.handle('message:search', async (_event, serverId: string, query: string, channel?: string) => {
    return searchMessages(serverId, query, { channel, limit: 50 })
  })

  // ── Notifications ───────────────────────────────────────────

  ipcMain.handle('notification:send', async (_event, title: string, body: string) => {
    if (Notification.isSupported()) {
      const notification = new Notification({ title, body, silent: false })
      notification.show()
    }
  })

  ipcMain.handle('tray:set-badge', async (_event, count: number) => {
    if (process.platform === 'darwin') {
      app.dock?.setBadge(count > 0 ? count.toString() : '')
    }
  })

  // ── Auto-update ────────────────────────────────────────────────

  ipcMain.handle('updater:install', async () => {
    autoUpdater.quitAndInstall(false, true)
  })

  ipcMain.handle('updater:check', async () => {
    if (!app.isPackaged) return { available: false }
    const result = await autoUpdater.checkForUpdates()
    return { available: !!result?.updateInfo, version: result?.updateInfo?.version }
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
    // Persist locally
    setReadMarker(serverId, channel, timestamp)

    // Sync with server if supported
    const client = ircManager.getClient(serverId)
    if (client && client.state.capabilities.has('draft/read-marker')) {
      client.connection.send('MARKREAD', channel, `timestamp=${timestamp}`)
    }
  })

  ipcMain.handle('read-marker:get', async (_event, serverId: string, channel: string) => {
    return getReadMarker(serverId, channel)
  })

  ipcMain.handle('read-marker:get-all', async (_event, serverId: string) => {
    return getAllReadMarkers(serverId)
  })
}
