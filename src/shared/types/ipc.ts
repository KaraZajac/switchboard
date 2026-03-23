/**
 * Typed IPC channel definitions.
 * Used by both main and renderer to ensure type safety across the bridge.
 */

import type { ServerConfig } from './server'
import type { ChatMessage } from './message'
import type { ChannelUser } from './channel'

// ── Main → Renderer events ──────────────────────────────────────────

export interface MainToRendererEvents {
  'irc:connected': { serverId: string; nick: string }
  'irc:disconnected': { serverId: string; reason: string }
  'irc:message': { serverId: string; channel: string; message: ChatMessage }
  'irc:join': { serverId: string; channel: string; user: ChannelUser }
  'irc:part': { serverId: string; channel: string; nick: string; reason: string | null }
  'irc:quit': { serverId: string; nick: string; reason: string | null }
  'irc:nick': { serverId: string; oldNick: string; newNick: string }
  'irc:topic': { serverId: string; channel: string; topic: string; setBy: string | null }
  'irc:mode': { serverId: string; channel: string; mode: string; params: string[] }
  'irc:kick': { serverId: string; channel: string; nick: string; by: string; reason: string | null }
  'irc:names': { serverId: string; channel: string; users: ChannelUser[] }
  'irc:away': { serverId: string; nick: string; message: string | null }
  'irc:account': { serverId: string; nick: string; account: string | null }
  'irc:typing': { serverId: string; channel: string; nick: string; status: 'active' | 'paused' | 'done' }
  'irc:error': { serverId: string; code: string; message: string }
  'irc:motd': { serverId: string; lines: string[] }
  'irc:whois': { serverId: string; data: Record<string, string> }
  'irc:react': { serverId: string; channel: string; nick: string; msgid: string; emoji: string }
  'irc:redact': { serverId: string; channel: string; msgid: string }
  'irc:edit': { serverId: string; channel: string; originalId: string; newContent: string; editedAt: string }
  'irc:read-marker': { serverId: string; channel: string; timestamp: string }
  'irc:cap': { serverId: string; capabilities: string[] }
  'irc:raw': { serverId: string; direction: 'in' | 'out'; line: string }
  'irc:setname': { serverId: string; nick: string; realname: string }
  'irc:metadata': { serverId: string; target: string; key: string; value: string }
  'irc:account-registered': { serverId: string; account: string; message: string }
  'irc:channel-rename': { serverId: string; oldName: string; newName: string; reason: string | null }
  'irc:network-icon': { serverId: string; url: string }
  'irc:filehost': { serverId: string; url: string }
  'irc:monitor-online': { serverId: string; nick: string; user: string | null; host: string | null }
  'irc:monitor-offline': { serverId: string; nick: string }
  'irc:chathistory': { serverId: string; channel: string; messages: ChatMessage[] }
  'irc:invite': { serverId: string; channel: string; by: string }
  'irc:search-results': { serverId: string; messages: ChatMessage[] }
  'irc:netsplit': { serverId: string; server1: string; server2: string; nicks: string[] }
  'irc:netjoin': { serverId: string; server1: string; server2: string; nicks: string[] }
  'menu:add-server': Record<string, never>
  'menu:settings': Record<string, never>
  'updater:checking': Record<string, never>
  'updater:available': { version: string }
  'updater:not-available': Record<string, never>
  'updater:progress': { percent: number }
  'updater:ready': { version: string }
}

// ── Renderer → Main invocations ─────────────────────────────────────

export interface RendererToMainInvocations {
  'server:connect': (serverId: string) => Promise<void>
  'server:disconnect': (serverId: string) => Promise<void>
  'server:add': (config: ServerConfig) => Promise<string>
  'server:update': (serverId: string, config: Partial<ServerConfig>) => Promise<void>
  'server:remove': (serverId: string) => Promise<void>
  'server:list': () => Promise<ServerConfig[]>
  'channel:join': (serverId: string, channel: string, key?: string) => Promise<void>
  'channel:part': (serverId: string, channel: string) => Promise<void>
  'channel:topic': (serverId: string, channel: string, topic: string) => Promise<void>
  'channel:list': (serverId: string) => Promise<{ name: string; userCount: number; topic: string }[]>
  'message:send': (serverId: string, channel: string, text: string) => Promise<void>
  'message:reply': (serverId: string, channel: string, text: string, replyTo: string) => Promise<void>
  'message:react': (serverId: string, channel: string, msgid: string, emoji: string) => Promise<void>
  'message:redact': (serverId: string, channel: string, msgid: string, reason?: string) => Promise<void>
  'message:edit': (serverId: string, channel: string, msgid: string, newText: string) => Promise<void>
  'message:typing': (serverId: string, channel: string, status?: 'active' | 'done') => Promise<void>
  'message:search': (serverId: string, query: string, channel?: string) => Promise<ChatMessage[]>
  'user:whois': (serverId: string, nick: string) => Promise<Record<string, string>>
  'user:kick': (serverId: string, channel: string, nick: string, reason?: string) => Promise<void>
  'user:nick': (serverId: string, nick: string) => Promise<void>
  'user:setname': (serverId: string, realname: string) => Promise<void>
  'metadata:get': (serverId: string, target: string, key: string) => Promise<void>
  'metadata:set': (serverId: string, key: string, value: string) => Promise<void>
  'account:register': (serverId: string, email: string | null, password: string) => Promise<boolean>
  'history:fetch': (serverId: string, channel: string, before?: string, limit?: number) => Promise<ChatMessage[]>
  'chathistory:request': (serverId: string, channel: string, before?: string, limit?: number) => Promise<void>
  'notification:send': (title: string, body: string) => Promise<void>
  'tray:set-badge': (count: number) => Promise<void>
  'settings:get': (key: string) => Promise<unknown>
  'settings:set': (key: string, value: unknown) => Promise<void>
  'read-marker:set': (serverId: string, channel: string, timestamp: string) => Promise<void>
  'read-marker:get': (serverId: string, channel: string) => Promise<string | null>
  'read-marker:get-all': (serverId: string) => Promise<Record<string, string>>
  'updater:install': () => Promise<void>
  'updater:check': () => Promise<{ available: boolean; version?: string }>
  'link-preview:fetch': (url: string) => Promise<LinkPreviewData | null>
  'file:upload': (serverId: string) => Promise<{ url: string; filename: string } | null>
  'message:search-server': (serverId: string, query: string, channel?: string) => Promise<void>
  'monitor:add': (serverId: string, nicks: string[]) => Promise<void>
  'monitor:remove': (serverId: string, nicks: string[]) => Promise<void>
  'monitor:list': (serverId: string) => Promise<string[]>
  'monitor:status': (serverId: string) => Promise<void>
}

/** OpenGraph metadata for link previews */
export interface LinkPreviewData {
  url: string
  title?: string
  description?: string
  siteName?: string
  image?: string
  favicon?: string
}
