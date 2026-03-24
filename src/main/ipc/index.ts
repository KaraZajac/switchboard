import { ipcMain, Notification, app, net, dialog } from 'electron'
import { readFile } from 'fs/promises'
import { basename, extname } from 'path'
import https from 'node:https'
import http from 'node:http'
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

    // Auto-clear away when sending a message
    if (client.state.away) {
      client.connection.send('AWAY')
    }

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
    // Strip newlines to prevent IRC command injection
    const safeText = text.replace(/[\r\n]+/g, ' ')
    // Send with +reply tag if echo-message is supported
    client.connection.sendRaw(
      `@+reply=${sanitizeTagValue(replyTo)} PRIVMSG ${channel} :${safeText}`
    )
  })

  ipcMain.handle('message:react', async (_event, serverId: string, channel: string, msgid: string, emoji: string) => {
    const client = ircManager.getClient(serverId)
    if (!client) throw new Error('Not connected')
    client.connection.sendRaw(
      `@+draft/react=${sanitizeTagValue(emoji)};+reply=${sanitizeTagValue(msgid)} TAGMSG ${channel}`
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

  ipcMain.handle('message:edit', async (_event, serverId: string, channel: string, msgid: string, newText: string) => {
    const client = ircManager.getClient(serverId)
    if (!client) throw new Error('Not connected')
    // Strip newlines to prevent IRC command injection
    const safeText = newText.replace(/[\r\n]+/g, ' ')
    // Send edited message with +draft/edit tag pointing to original message ID
    client.connection.sendRaw(`@+draft/edit=${sanitizeTagValue(msgid)} PRIVMSG ${channel} :${safeText}`)
  })

  ipcMain.handle('message:typing', async (_event, serverId: string, channel: string, status: 'active' | 'done' = 'active') => {
    const client = ircManager.getClient(serverId)
    if (!client) throw new Error('Not connected')
    client.connection.sendRaw(`@+typing=${sanitizeTagValue(status)} TAGMSG ${channel}`)
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

  ipcMain.handle('user:away', async (_event, serverId: string, message?: string) => {
    const client = ircManager.getClient(serverId)
    if (!client) throw new Error('Not connected')
    if (message) {
      client.connection.send('AWAY', message)
    } else {
      client.connection.send('AWAY')
    }
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
    // Validate key — must be alphanumeric/dashes only (no spaces or protocol chars)
    if (!/^[a-zA-Z0-9_-]+$/.test(key)) throw new Error('Invalid metadata key')

    // Use sendRaw to avoid the serializer adding a trailing ':' prefix
    // which some server implementations incorrectly store as part of the value
    if (value.includes(' ') || value.startsWith(':')) {
      client.connection.sendRaw(`METADATA * SET ${key} :${value}`)
    } else {
      client.connection.sendRaw(`METADATA * SET ${key} ${value}`)
    }
    // Persist avatar URL locally so it survives restarts
    if (key === 'avatar') {
      updateServer(serverId, { avatarUrl: value || null })
      client.config.avatarUrl = value || null
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

  ipcMain.handle('message:search-server', async (_event, serverId: string, query: string, channel?: string) => {
    const client = ircManager.getClient(serverId)
    if (!client) throw new Error('Not connected')
    if (!client.state.capabilities.has('draft/search')) {
      throw new Error('Server does not support search')
    }
    // Send SEARCH command — results arrive via irc:search-results event
    if (channel) {
      client.connection.sendRaw(`SEARCH :in:${channel} ${query}`)
    } else {
      client.connection.sendRaw(`SEARCH :${query}`)
    }
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

  // ── Monitor (friend list) ──────────────────────────────────────────

  ipcMain.handle('monitor:add', async (_event, serverId: string, nicks: string[]) => {
    const { addToMonitorList } = await import('../storage/models/monitor')
    addToMonitorList(serverId, nicks)
    const client = ircManager.getClient(serverId)
    if (client) {
      client.connection.send('MONITOR', '+', nicks.join(','))
    }
  })

  ipcMain.handle('monitor:remove', async (_event, serverId: string, nicks: string[]) => {
    const { removeFromMonitorList } = await import('../storage/models/monitor')
    removeFromMonitorList(serverId, nicks)
    const client = ircManager.getClient(serverId)
    if (client) {
      client.connection.send('MONITOR', '-', nicks.join(','))
    }
  })

  ipcMain.handle('monitor:list', async (_event, serverId: string) => {
    const { getMonitorList } = await import('../storage/models/monitor')
    return getMonitorList(serverId)
  })

  ipcMain.handle('monitor:status', async (_event, serverId: string) => {
    const client = ircManager.getClient(serverId)
    if (client) {
      client.connection.send('MONITOR', 'S')
    }
  })

  // ── File upload (draft/FILEHOST) ────────────────────────────────────

  ipcMain.handle('file:upload', async (_event, serverId: string) => {
    const client = ircManager.getClient(serverId)
    if (!client) throw new Error('Not connected')

    const filehostUrl = client.state.isupport['FILEHOST'] || client.state.isupport['draft/FILEHOST']
    if (typeof filehostUrl !== 'string') throw new Error('Server does not support file uploads')
    if (!/^https?:\/\//i.test(filehostUrl)) throw new Error('Invalid filehost URL')

    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [
        { name: 'All Files', extensions: ['*'] },
        { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'] },
        { name: 'Videos', extensions: ['mp4', 'webm', 'mov', 'avi'] },
        { name: 'Documents', extensions: ['pdf', 'txt', 'md', 'log'] }
      ]
    })

    if (result.canceled || result.filePaths.length === 0) return null

    const filePath = result.filePaths[0]
    const fileName = basename(filePath)
    const fileData = await readFile(filePath)

    const MIME_MAP: Record<string, string> = {
      '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
      '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
      '.bmp': 'image/bmp', '.mp4': 'video/mp4', '.webm': 'video/webm',
      '.mov': 'video/quicktime', '.avi': 'video/x-msvideo',
      '.pdf': 'application/pdf', '.txt': 'text/plain', '.md': 'text/markdown',
      '.log': 'text/plain', '.zip': 'application/zip',
    }
    const contentType = MIME_MAP[extname(filePath).toLowerCase()] || 'application/octet-stream'

    // Build auth header from SASL credentials
    const headers: Record<string, string> = {
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Content-Length': fileData.length.toString()
    }

    const config = getServer(serverId)
    if (config?.saslUsername && config?.saslPassword) {
      const credentials = Buffer.from(`${config.saslUsername}:${config.saslPassword}`).toString('base64')
      headers['Authorization'] = `Basic ${credentials}`
    }

    // Use Node http/https directly — Electron patches global fetch with net.fetch
    // which rejects Buffer bodies with ERR_INVALID_ARGUMENT
    const url = new URL(filehostUrl)
    const httpMod = url.protocol === 'https:' ? https : http

    const location = await new Promise<string>((resolve, reject) => {
      const req = httpMod.request(url, {
        method: 'POST',
        headers
      }, (res) => {
        let body = ''
        res.on('data', (chunk: Buffer) => { body += chunk.toString() })
        res.on('end', () => {
          if (res.statusCode !== 201) {
            reject(new Error(`Upload failed (${res.statusCode}): ${body}`))
            return
          }
          const loc = res.headers['location'] || body.trim()
          if (!loc) {
            reject(new Error('Server did not return a file URL'))
            return
          }
          // Resolve relative URLs
          resolve(loc.startsWith('http') ? loc : new URL(loc, filehostUrl).href)
        })
      })

      req.on('error', reject)
      req.write(fileData)
      req.end()
    })

    return { url: location, filename: fileName }
  })

  // ── Link previews ──────────────────────────────────────────────────

  const linkPreviewCache = new Map<string, { data: import('@shared/types/ipc').LinkPreviewData | null; ts: number }>()
  const PREVIEW_CACHE_TTL = 10 * 60 * 1000 // 10 minutes
  const PREVIEW_CACHE_MAX = 200

  ipcMain.handle('link-preview:fetch', async (_event, url: string) => {
    // Only fetch http/https URLs
    if (!/^https?:\/\//i.test(url)) return null

    // Don't fetch previews for images/media — they're rendered inline
    if (/\.(jpg|jpeg|png|gif|webp|svg|mp4|webm)(\?.*)?$/i.test(url)) return null

    const cached = linkPreviewCache.get(url)
    if (cached && Date.now() - cached.ts < PREVIEW_CACHE_TTL) return cached.data

    // Evict oldest entries if cache is full
    if (linkPreviewCache.size >= PREVIEW_CACHE_MAX) {
      const first = linkPreviewCache.keys().next().value
      if (first) linkPreviewCache.delete(first)
    }

    try {
      const response = await net.fetch(url, {
        headers: { 'User-Agent': 'Switchboard IRC Client/1.0' },
        redirect: 'follow'
      })

      const contentType = response.headers.get('content-type') || ''
      if (!contentType.includes('text/html')) {
        linkPreviewCache.set(url, { data: null, ts: Date.now() })
        return null
      }

      // Only read first 32KB for metadata
      const buffer = await response.arrayBuffer()
      const html = new TextDecoder().decode(buffer.slice(0, 32768))

      const get = (property: string): string | undefined => {
        // Try og: tags first, then twitter: fallback
        const ogMatch = html.match(new RegExp(`<meta[^>]+property=["']og:${property}["'][^>]+content=["']([^"']+)["']`, 'i'))
          || html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:${property}["']`, 'i'))
        if (ogMatch) return decodeHTMLEntities(ogMatch[1])

        const twMatch = html.match(new RegExp(`<meta[^>]+name=["']twitter:${property}["'][^>]+content=["']([^"']+)["']`, 'i'))
          || html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:${property}["']`, 'i'))
        if (twMatch) return decodeHTMLEntities(twMatch[1])

        return undefined
      }

      const title = get('title') || html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim()
      const description = get('description')
      const siteName = get('site_name')
      let image = get('image')

      // Resolve relative image URLs
      if (image && !image.startsWith('http')) {
        try {
          image = new URL(image, url).href
        } catch { /* ignore */ }
      }

      // Get favicon
      let favicon: string | undefined
      const iconMatch = html.match(/<link[^>]+rel=["'](?:shortcut )?icon["'][^>]+href=["']([^"']+)["']/i)
        || html.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["'](?:shortcut )?icon["']/i)
      if (iconMatch) {
        favicon = iconMatch[1]
        if (!favicon.startsWith('http')) {
          try { favicon = new URL(favicon, url).href } catch { /* ignore */ }
        }
      } else {
        try { favicon = new URL('/favicon.ico', url).href } catch { /* ignore */ }
      }

      if (!title && !description && !image) {
        linkPreviewCache.set(url, { data: null, ts: Date.now() })
        return null
      }

      const data: import('@shared/types/ipc').LinkPreviewData = {
        url, title, description, siteName, image, favicon
      }
      linkPreviewCache.set(url, { data, ts: Date.now() })
      return data
    } catch {
      linkPreviewCache.set(url, { data: null, ts: Date.now() })
      return null
    }
  })
}

/** Escape IRC message tag values per IRCv3 spec — prevents tag injection */
function sanitizeTagValue(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\:')
    .replace(/ /g, '\\s')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
}

function decodeHTMLEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec)))
}
