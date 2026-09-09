/**
 * Typed IPC channel definitions.
 * Used by both main and renderer to ensure type safety across the bridge.
 */

import type { ServerConfig } from './server'
import type { ChatMessage } from './message'
import type { ChannelUser } from './channel'
import type { UserMetadata } from './metadata'

/**
 * Live state of one connected server, handed to the renderer when it attaches.
 *
 * Connection events are fire-and-forget: anything the main process emits before
 * the renderer has registered its listeners (auto-connect on launch, a window
 * reload) is gone. The renderer asks for this snapshot on mount to catch up.
 */
export interface ConnectionSnapshot {
  serverId: string
  nick: string
  capabilities: string[]
  /** draft/metadata-2 values by lowercase nick, so a new client starts in sync */
  metadata: Record<string, UserMetadata>
  channels: {
    name: string
    topic: string | null
    topicSetBy: string | null
    users: ChannelUser[]
  }[]
}

/** A device paired to this desktop over the remote link */
export interface PairedDeviceInfo {
  endpointId: string
  name: string
  pairedAt: string
  lastSeenAt: string | null
}

/** Which device is holding the IRC connections right now */
export interface SessionSnapshot {
  role: 'primary' | 'follower'
  priority: number
  since: string | null
  claiming: boolean
  peers: Record<string, { role: 'primary' | 'follower'; priority: number; lastSeen: number }>
  vaultVersion: number
}

/** The shared, passphrase-protected config both devices work from */
export interface VaultStatusInfo {
  exists: boolean
  unlocked: boolean
  version: number
  updatedAt: string | null
  updatedBy: string | null
  fingerprint: string | null
}

/**
 * How much of what is on disk is actually protected.
 *
 * Two separate things, because they can and do differ: passwords are encrypted
 * field by field with a key from the OS keystore, and the database as a whole
 * is encrypted page by page with a key the same keystore holds. Without a
 * keyring the first degrades to obfuscation and the second does not happen at
 * all, and the user is owed both facts rather than a single reassuring light.
 */
export interface StorageProtection {
  /** Whether passwords are really encrypted, rather than merely obfuscated */
  protected: boolean
  description: string
  /** Whether the database file itself is encrypted */
  databaseEncrypted: boolean
}

/** State of the peer-to-peer link that paired devices connect through */
export interface RemoteLinkStatus {
  available: boolean
  running: boolean
  endpointId: string | null
  /** Dialable address for this desktop, encoded for a QR code */
  ticket: string | null
  pairing: { code: string; expiresAt: number } | null
  devices: PairedDeviceInfo[]
  connected: string[]
  error: string | null
}

// ── Main → Renderer events ──────────────────────────────────────────

export interface MainToRendererEvents {
  /**
   * The stored server list changed somewhere other than this window — a paired
   * phone edited it, or an adopted vault replaced it. Carries nothing: the
   * window re-reads, so there is one description of the servers.
   */
  'servers:changed': undefined
  'irc:connected': { serverId: string; nick: string }
  'irc:disconnected': { serverId: string; reason: string }
  'irc:message': { serverId: string; channel: string; message: ChatMessage }
  'irc:join': { serverId: string; channel: string; user: ChannelUser }
  'irc:part': { serverId: string; channel: string; nick: string; reason: string | null; isMe: boolean }
  'irc:quit': { serverId: string; nick: string; reason: string | null }
  'irc:nick': { serverId: string; oldNick: string; newNick: string }
  'irc:topic': { serverId: string; channel: string; topic: string; setBy: string | null }
  'irc:mode': { serverId: string; channel: string; mode: string; params: string[] }
  'irc:kick': { serverId: string; channel: string; nick: string; by: string; reason: string | null; isMe: boolean }
  'irc:names': { serverId: string; channel: string; users: ChannelUser[] }
  'irc:away': { serverId: string; nick: string; message: string | null }
  'irc:account': { serverId: string; nick: string; account: string | null }
  'irc:typing': { serverId: string; channel: string; nick: string; status: 'active' | 'paused' | 'done' }
  'irc:error': { serverId: string; code: string; message: string }
  'irc:motd': { serverId: string; lines: string[] }
  'irc:whois': { serverId: string; data: Record<string, string> }
  'irc:react': {
    serverId: string
    channel: string
    nick: string
    msgid: string
    emoji: string
    /** An unreact: the same shape, taking one back */
    removed: boolean
  }
  'irc:redact': { serverId: string; channel: string; msgid: string }
  'irc:edit': { serverId: string; channel: string; originalId: string; newContent: string; editedAt: string }
  'irc:read-marker': { serverId: string; channel: string; timestamp: string }
  'irc:cap': { serverId: string; capabilities: string[] }
  'irc:raw': { serverId: string; direction: 'in' | 'out'; line: string }
  'irc:verify': { serverId: string; account: string; message: string }
  'irc:webpush': { serverId: string; subcommand: string; endpoint: string }
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
  'window:maximized': { maximized: boolean }
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
  /** Renderer has attached its event listeners: releases auto-connect, returns live state */
  'app:renderer-ready': () => Promise<ConnectionSnapshot[]>
  /** Remote link (paired phones and tablets) */
  'remote:status': () => Promise<RemoteLinkStatus>
  'session:state': () => Promise<SessionSnapshot>
  'vault:status': () => Promise<VaultStatusInfo>
  'vault:create': (passphrase: string) => Promise<VaultStatusInfo>
  'vault:unlock': (passphrase: string) => Promise<VaultStatusInfo>
  'vault:lock': () => Promise<VaultStatusInfo>
  'remote:start': () => Promise<RemoteLinkStatus>
  'remote:stop': () => Promise<RemoteLinkStatus>
  'remote:start-pairing': () => Promise<RemoteLinkStatus>
  'remote:cancel-pairing': () => Promise<RemoteLinkStatus>
  'remote:revoke': (endpointId: string) => Promise<RemoteLinkStatus>
  /** Where stored credentials are protected, and whether they really are */
  'app:secrets-status': () => Promise<StorageProtection>
  /** OS account name, cleaned up for use as an IRC nick */
  'app:default-nick': () => Promise<string>
  'window:minimize': () => Promise<void>
  /** Toggles maximize; resolves with the new state */
  'window:maximize': () => Promise<boolean>
  'window:close': () => Promise<void>
  'window:is-maximized': () => Promise<boolean>
  'channel:join': (serverId: string, channel: string, key?: string) => Promise<void>
  'channel:part': (serverId: string, channel: string) => Promise<void>
  'channel:topic': (serverId: string, channel: string, topic: string) => Promise<void>
  'channel:list': (serverId: string) => Promise<{ name: string; userCount: number; topic: string }[]>
  'message:send': (serverId: string, channel: string, text: string) => Promise<void>
  'message:reply': (serverId: string, channel: string, text: string, replyTo: string) => Promise<void>
  'message:react': (
    serverId: string,
    channel: string,
    msgid: string,
    emoji: string,
    /** Take the reaction back rather than adding it */
    remove?: boolean
  ) => Promise<void>
  'message:redact': (serverId: string, channel: string, msgid: string, reason?: string) => Promise<void>
  'message:edit': (serverId: string, channel: string, msgid: string, newText: string) => Promise<void>
  'message:typing': (serverId: string, channel: string, status?: 'active' | 'done') => Promise<void>
  'message:search': (serverId: string, query: string, channel?: string) => Promise<ChatMessage[]>
  'user:whois': (serverId: string, nick: string) => Promise<Record<string, string>>
  'user:kick': (serverId: string, channel: string, nick: string, reason?: string) => Promise<void>
  'user:nick': (serverId: string, nick: string) => Promise<void>
  'user:setname': (serverId: string, realname: string) => Promise<void>
  'user:away': (serverId: string, message?: string) => Promise<void>
  'metadata:get': (serverId: string, target: string, key: string) => Promise<void>
  'metadata:set': (serverId: string, key: string, value: string) => Promise<void>
  'account:register': (serverId: string, email: string | null, password: string) => Promise<boolean>
  'account:verify': (serverId: string, account: string, code: string) => Promise<boolean>
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
