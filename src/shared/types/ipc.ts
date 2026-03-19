/**
 * Typed IPC channel definitions.
 * Used by both main and renderer to ensure type safety across the bridge.
 */

import type { ServerConfig } from './server'
import type { ChatMessage } from './message'
import type { ChannelUser } from './channel'

// ── Main → Renderer events ──────────────────────────────────────────

export interface MainToRendererEvents {
  'irc:connected': { serverId: string }
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
  'irc:read-marker': { serverId: string; channel: string; timestamp: string }
  'irc:cap': { serverId: string; capabilities: string[] }
  'irc:raw': { serverId: string; direction: 'in' | 'out'; line: string }
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
  'message:send': (serverId: string, channel: string, text: string) => Promise<void>
  'message:reply': (serverId: string, channel: string, text: string, replyTo: string) => Promise<void>
  'message:react': (serverId: string, channel: string, msgid: string, emoji: string) => Promise<void>
  'message:redact': (serverId: string, channel: string, msgid: string, reason?: string) => Promise<void>
  'message:typing': (serverId: string, channel: string) => Promise<void>
  'user:whois': (serverId: string, nick: string) => Promise<Record<string, string>>
  'user:kick': (serverId: string, channel: string, nick: string, reason?: string) => Promise<void>
  'history:fetch': (serverId: string, channel: string, before?: string, limit?: number) => Promise<ChatMessage[]>
  'settings:get': (key: string) => Promise<unknown>
  'settings:set': (key: string, value: unknown) => Promise<void>
  'read-marker:set': (serverId: string, channel: string, timestamp: string) => Promise<void>
}
