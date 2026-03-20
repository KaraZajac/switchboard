import { BrowserWindow } from 'electron'
import type { ServerConfig } from '@shared/types/server'
import type { IRCMessage } from '@shared/types/irc'
import type { ChatMessage } from '@shared/types/message'
import { IRCClient } from './client'
import { storeMessage, deleteMessage } from '../storage/models/message'
import { v4 as uuid } from 'uuid'

/**
 * Manages all IRC client connections and bridges events to the renderer.
 */
export class IRCManager {
  private clients = new Map<string, IRCClient>()
  private mainWindow: BrowserWindow | null = null

  setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window
  }

  /**
   * Connect to a server with the given config.
   */
  connect(config: ServerConfig): void {
    // Disconnect existing connection for this server
    if (this.clients.has(config.id)) {
      this.disconnect(config.id)
    }

    const client = new IRCClient(config)
    this.clients.set(config.id, client)
    this.bindClientEvents(config.id, client)
    client.connect()
  }

  /**
   * Disconnect from a server.
   */
  disconnect(serverId: string): void {
    const client = this.clients.get(serverId)
    if (client) {
      client.destroy()
      this.clients.delete(serverId)
      this.send('irc:disconnected', { serverId, reason: 'User quit' })
    }
  }

  /**
   * Get a client by server ID.
   */
  getClient(serverId: string): IRCClient | undefined {
    return this.clients.get(serverId)
  }

  /**
   * Get all connected server IDs.
   */
  getConnectedServerIds(): string[] {
    return Array.from(this.clients.keys()).filter(
      (id) => this.clients.get(id)?.connection.connected
    )
  }

  /**
   * Disconnect all servers and clean up.
   */
  destroyAll(): void {
    for (const [, client] of this.clients) {
      client.destroy()
    }
    this.clients.clear()
  }

  // ── Event bridging to renderer ───────────────────────────────────

  private send(channel: string, data: unknown): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(channel, data)
    }
  }

  private bindClientEvents(serverId: string, client: IRCClient): void {
    // Connection events
    client.events.on('registered', (data) => {
      this.send('irc:connected', { serverId, nick: data.nick })
    })

    client.events.on('disconnected', (reason) => {
      this.send('irc:disconnected', { serverId, reason })
    })

    client.events.on('connectionError', (error) => {
      this.send('irc:error', {
        serverId,
        code: 'CONNECTION',
        message: error.message
      })
    })

    // Channel events
    client.events.on('join', (data) => {
      this.send('irc:join', {
        serverId,
        channel: data.channel,
        user: data.user
      })
    })

    client.events.on('part', (data) => {
      this.send('irc:part', {
        serverId,
        channel: data.channel,
        nick: data.nick,
        reason: data.reason
      })
    })

    client.events.on('kick', (data) => {
      this.send('irc:kick', {
        serverId,
        channel: data.channel,
        nick: data.nick,
        by: data.by,
        reason: data.reason
      })
    })

    client.events.on('topic', (data) => {
      this.send('irc:topic', {
        serverId,
        channel: data.channel,
        topic: data.topic,
        setBy: data.setBy
      })
    })

    client.events.on('names', (data) => {
      this.send('irc:names', {
        serverId,
        channel: data.channel,
        users: data.users
      })
    })

    client.events.on('mode', (data) => {
      this.send('irc:mode', {
        serverId,
        channel: data.channel,
        mode: data.mode,
        params: data.params
      })
    })

    // Message events
    client.events.on('privmsg', (data) => {
      const message: ChatMessage = {
        id: data.msgid || uuid(),
        serverId,
        channel: data.channel,
        nick: data.nick,
        userHost: data.userHost,
        content: data.content,
        type: data.type,
        tags: data.tags as Record<string, string>,
        replyTo: data.replyTo || null,
        timestamp: data.time,
        account: data.account || null,
        pending: false,
        reactions: {},
        channelContext: typeof data.tags['+draft/channel-context'] === 'string'
          ? data.tags['+draft/channel-context'] : null
      }

      // Store in database
      storeMessage(message)

      this.send('irc:message', { serverId, channel: data.channel, message })
    })

    client.events.on('notice', (data) => {
      const message: ChatMessage = {
        id: data.msgid || uuid(),
        serverId,
        channel: data.channel,
        nick: data.nick,
        userHost: null,
        content: data.content,
        type: 'notice',
        tags: data.tags as Record<string, string>,
        replyTo: null,
        timestamp: data.time,
        account: null,
        pending: false,
        reactions: {},
        channelContext: null
      }

      storeMessage(message)
      this.send('irc:message', { serverId, channel: data.channel, message })
    })

    // User events
    client.events.on('nick', (data) => {
      this.send('irc:nick', { serverId, ...data })
    })

    client.events.on('quit', (data) => {
      this.send('irc:quit', { serverId, ...data })
    })

    client.events.on('typing', (data) => {
      this.send('irc:typing', { serverId, ...data })
    })

    client.events.on('react', (data) => {
      this.send('irc:react', { serverId, ...data })
    })

    client.events.on('redact', (data: { channel: string; msgid: string; nick: string; reason: string | null }) => {
      // Delete from local database
      deleteMessage(data.msgid)
      this.send('irc:redact', { serverId, channel: data.channel, msgid: data.msgid })
    })

    client.events.on('away', (data) => {
      this.send('irc:away', { serverId, ...data })
    })

    client.events.on('account', (data) => {
      this.send('irc:account', { serverId, ...data })
    })

    client.events.on('setname', (data: { nick: string; realname: string }) => {
      this.send('irc:setname', { serverId, ...data })
    })

    client.events.on('metadata', (data: { target: string; key: string; value: string }) => {
      this.send('irc:metadata', { serverId, ...data })
    })

    // Account registration
    client.events.on('accountRegistered', (data: { account: string; message: string }) => {
      this.send('irc:account-registered', { serverId, ...data })
    })

    // Channel rename
    client.events.on('channelRename', (data: { oldName: string; newName: string; reason: string | null }) => {
      this.send('irc:channel-rename', { serverId, ...data })
    })

    // Chathistory batch
    client.events.on('chathistoryBatch', (data: { target: string; messages: IRCMessage[] }) => {
      const chatMessages: ChatMessage[] = data.messages
        .filter((m) => m.command === 'PRIVMSG' || m.command === 'NOTICE')
        .map((m) => {
          const text = m.params[1] || ''
          const isAction = text.startsWith('\x01ACTION ') && text.endsWith('\x01')
          const content = isAction ? text.slice(8, -1) : text

          const msg: ChatMessage = {
            id: (typeof m.tags['msgid'] === 'string' ? m.tags['msgid'] : uuid()),
            serverId,
            channel: data.target,
            nick: m.source?.nick || '',
            userHost: m.source ? `${m.source.user || ''}@${m.source.host || ''}` : null,
            content,
            type: isAction ? 'action' : m.command === 'NOTICE' ? 'notice' : 'privmsg',
            tags: m.tags as Record<string, string>,
            replyTo: typeof m.tags['+reply'] === 'string' ? m.tags['+reply'] : null,
            timestamp: typeof m.tags['time'] === 'string' ? m.tags['time'] : new Date().toISOString(),
            account: typeof m.tags['account'] === 'string' ? m.tags['account'] : null,
            pending: false,
            reactions: {},
            channelContext: typeof m.tags['+draft/channel-context'] === 'string'
              ? m.tags['+draft/channel-context'] : null
          }
          storeMessage(msg)
          return msg
        })

      this.send('irc:chathistory', {
        serverId,
        channel: data.target,
        messages: chatMessages
      })
    })

    // Netsplit/netjoin batch events
    client.events.on('netsplit', (data: { server1: string; server2: string; quits: { nick: string }[] }) => {
      this.send('irc:netsplit', {
        serverId,
        server1: data.server1,
        server2: data.server2,
        nicks: data.quits.map((q) => q.nick)
      })
    })

    client.events.on('netjoin', (data: { server1: string; server2: string; joins: { nick: string }[] }) => {
      this.send('irc:netjoin', {
        serverId,
        server1: data.server1,
        server2: data.server2,
        nicks: data.joins.map((j) => j.nick)
      })
    })

    // Server info events
    client.events.on('motd', (lines) => {
      this.send('irc:motd', { serverId, lines })
    })

    client.events.on('readMarker', (data: { channel: string; timestamp: string }) => {
      this.send('irc:read-marker', {
        serverId,
        channel: data.channel,
        timestamp: data.timestamp
      })
    })

    client.events.on('capNegotiated', (caps) => {
      this.send('irc:cap', { serverId, capabilities: caps })
    })

    client.events.on('whois', (data) => {
      this.send('irc:whois', { serverId, data })
    })

    // Error events
    client.events.on('error', (data) => {
      this.send('irc:error', { serverId, ...data })
    })

    // Raw (debug)
    client.events.on('raw', (direction, line) => {
      this.send('irc:raw', { serverId, direction, line })
    })
  }
}

/** Singleton manager instance */
export const ircManager = new IRCManager()
