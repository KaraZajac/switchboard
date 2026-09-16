/**
 * Typed IPC channel definitions.
 * Used by both main and renderer to ensure type safety across the bridge.
 */

import type { ServerConfig } from './server'
import type { CertificateProblem } from '../certificate'
import type { ChatMessage, MessageType } from './message'
import type { ChannelUser } from './channel'
import type { UserMetadata } from './metadata'
import type { MaskEntry } from '../masklists'
import type { IgnoreEntry, IgnoreScope } from '../ignore'
import type { DccTransfer } from '../dcc'
import type { Holder } from '../holding'
import type { Found } from '../search'

/**
 * One line that named you, with enough around it to show and to go to.
 *
 * Not a `ChatMessage`: this crosses networks, so it carries which one it was
 * on — the field a message never needs while it sits in the one conversation
 * it belongs to.
 */
export interface Mention {
  /** The message's own id, so a jump can find the line rather than the room */
  id: string
  serverId: string
  serverName: string
  channel: string
  nick: string
  content: string
  type: MessageType
  timestamp: string
}

/**
 * Live state of one connected server, handed to the renderer when it attaches.
 *
 * Connection events are fire-and-forget: anything the main process emits before
 * the renderer has registered its listeners (auto-connect on launch, a window
 * reload) is gone. The renderer asks for this snapshot on mount to catch up.
 */
export interface ConnectionSnapshot {
  /** ISUPPORT, so a following device can decide a member menu the same way */
  isupport?: Record<string, string>
  serverId: string
  nick: string
  /** The account this connection is logged in to, if any */
  account: string | null
  capabilities: string[]
  /**
   * What each capability the server offered said about itself, by name.
   *
   * The names alone answer "is this supported"; the values answer everything
   * else — whether registering an account needs an email address, how short a
   * password may be, which SASL mechanisms exist. A paired phone has no
   * connection of its own to read them from, so without this it can offer a
   * form it cannot fill in correctly.
   */
  capabilityValues: Record<string, string>
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
/**
 * One message as a phone hands it over.
 *
 * Deliberately the shape the phone already builds for `irc:message`, so there
 * is nothing to keep in step by hand: it forwards what it filed.
 */
export interface HandoverMessage {
  id: string
  channel: string
  nick?: string
  content: string
  timestamp: string
  type?: MessageType
  account?: string | null
  oper?: string | null
  relayedBy?: string | null
  replyTo?: string | null
}

/**
 * One line of the wire, for the server log.
 *
 * Credentials are already masked: the desktop does it as the line is kept, so
 * a log that is copied or saved has never held the secret at all.
 */
export interface RawLine {
  at: string
  direction: 'in' | 'out'
  line: string
}

export interface VaultStatusInfo {
  exists: boolean
  unlocked: boolean
  version: number
  updatedAt: string | null
  updatedBy: string | null
  fingerprint: string | null
  /** The key is kept in the keychain, so a restart opens it without asking */
  remembered: boolean
  /** Whether this machine has a keychain to keep it in at all */
  canRemember: boolean
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
  /**
   * Instances this one dials rather than waits for.
   *
   * A phone dials a desktop, so a desktop never had to. A headless instance
   * waits like a desktop does, and two waiting peers never find each other —
   * so whichever has the other's ticket goes looking.
   */
  dialled: { ticket: string; name?: string; connected: boolean }[]
  error: string | null
}

// ── Main → Renderer events ──────────────────────────────────────────

export interface MainToRendererEvents {
  /**
   * How far the current upload has got, in bytes.
   *
   * `total` is 0 when the size is not known before sending, which a stream
   * from some sources genuinely is not.
   */
  'file:upload-progress': { serverId: string; sent: number; total: number }
  /**
   * The stored server list changed somewhere other than this window — a paired
   * phone edited it, or an adopted vault replaced it. Carries nothing: the
   * window re-reads, so there is one description of the servers.
   */
  'servers:changed': undefined
  /** Which device is holding the connections changed; the window re-asks */
  'session:changed': undefined
  /** The watched-nicks list for one network changed somewhere other than here */
  'monitor:changed': { serverId: string }
  /** A stored setting changed somewhere other than here — the theme, most visibly */
  'settings:changed': { key: string }
  /**
   * Somebody typed `/clear`, here or on a paired device.
   *
   * The view, not the log: nothing is deleted and scrolling up fetches it all
   * back. It arrives as an event rather than being done in the composer so
   * that a command typed on the phone empties this window too.
   */
  'chat:clear': { serverId: string; channel: string }
  /** The ignore list changed from somewhere other than the settings panel */
  'ignore:changed': IgnoreEntry[]
  /**
   * The networks a bouncer says it holds behind itself.
   *
   * `boundTo` is which of them this connection is on, or null when it is
   * talking to the bouncer itself — which is when there is something to offer.
   */
  'irc:bouncer-networks': {
    serverId: string
    boundTo: string | null
    networks: import('@shared/bouncer').BouncerNetwork[]
  }
  'irc:connected': { serverId: string; nick: string; account: string | null }
  'irc:disconnected': { serverId: string; reason: string }
  /** The connection was lost and a retry is booked, this far away */
  'irc:reconnecting': { serverId: string; delayMs: number }
  /** Stored history grew from somewhere other than this window — a phone handing over */
  'history:changed': { serverId: string }
  /** The server's certificate was refused; the fingerprint is the thing to check — see `@shared/certificate` */
  'irc:certificate': { serverId: string } & CertificateProblem
  /** An irc:// link named a network we have; show this conversation on it — see `@shared/ircurl` */
  'link:open': { serverId: string; channel: string }
  /** An irc:// link named a network we do not have; offer to add it */
  'link:add-server': { host: string; port: number; tls: boolean; channel: string | null }
  'irc:message': { serverId: string; channel: string; message: ChatMessage }
  'irc:join': { serverId: string; channel: string; user: ChannelUser; isMe: boolean }
  'irc:part': {
    serverId: string
    channel: string
    nick: string
    reason: string | null
    isMe: boolean
  }
  'irc:quit': { serverId: string; nick: string; reason: string | null }
  'irc:nick': { serverId: string; oldNick: string; newNick: string }
  'irc:topic': { serverId: string; channel: string; topic: string; setBy: string | null }
  'irc:mode': { serverId: string; channel: string; mode: string; params: string[] }
  /** One of a channel's mask lists, whole — bans, quiets, exceptions, invites */
  /** A transfer started, moved or finished */
  'dcc:transfer': DccTransfer
  /** `/dcc send` was typed; the window has to open a file picker */
  'dcc:offer-wanted': { serverId: string; nick: string }
  'irc:masklist': {
    serverId: string
    channel: string
    mode: string
    entries: MaskEntry[]
    done: boolean
  }
  'irc:kick': {
    serverId: string
    channel: string
    nick: string
    by: string
    reason: string | null
    isMe: boolean
  }
  'irc:names': { serverId: string; channel: string; users: ChannelUser[] }
  'irc:away': { serverId: string; nick: string; message: string | null }
  'irc:account': { serverId: string; nick: string; account: string | null }
  'irc:typing': {
    serverId: string
    channel: string
    nick: string
    status: 'active' | 'paused' | 'done'
  }
  'irc:error': {
    serverId: string
    code: string
    /** The command that was refused, where the server named one */
    command?: string
    message: string
  }
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
  'irc:edit': {
    serverId: string
    channel: string
    originalId: string
    newContent: string
    editedAt: string
  }
  'irc:read-marker': { serverId: string; channel: string; timestamp: string }
  'irc:cap': {
    serverId: string
    capabilities: string[]
    /** What each capability the server offered said about itself, by name */
    values: Record<string, string>
  }
  'irc:raw': { serverId: string; direction: 'in' | 'out'; line: string }
  /** One line of the wire, as the server log shows it — see `RawLine` */
  'irc:raw-line': { serverId: string; entry: RawLine }
  'irc:verify': { serverId: string; status: string; account: string; message: string }
  'irc:webpush': { serverId: string; subcommand: string; endpoint: string }
  'irc:setname': { serverId: string; nick: string; realname: string }
  'irc:metadata': { serverId: string; target: string; key: string; value: string }
  'irc:account-registered': {
    serverId: string
    /** SUCCESS, or VERIFICATION_REQUIRED when a code has been emailed */
    status: string
    account: string
    message: string
  }
  'irc:channel-rename': {
    serverId: string
    oldName: string
    newName: string
    reason: string | null
  }
  /** ISUPPORT as the server sent it: PREFIX and CHANMODES decide a member menu */
  'irc:isupport': { serverId: string; tokens: Record<string, string> }
  'irc:network-icon': { serverId: string; url: string }
  'irc:filehost': { serverId: string; url: string }
  'irc:monitor-online': { serverId: string; nick: string; user: string | null; host: string | null }
  'irc:monitor-offline': { serverId: string; nick: string }
  'irc:chathistory': { serverId: string; channel: string; messages: ChatMessage[] }
  /** A conversation that had traffic while this device was closed */
  'irc:chathistory-target': { serverId: string; target: string; timestamp: string }
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
  /** Trust this one certificate for this server, and dial it again — see `@shared/certificate` */
  'server:trust-certificate': (serverId: string, fingerprint: string) => Promise<void>
  /** Where the plain-text logs go, and a way to open it — see `logging.ts` */
  'logs:folder': () => Promise<string>
  'logs:open': () => Promise<void>
  'server:remove': (serverId: string) => Promise<void>
  'server:list': () => Promise<ServerConfig[]>
  /** Renderer has attached its event listeners: releases auto-connect, returns live state */
  'app:renderer-ready': () => Promise<ConnectionSnapshot[]>
  /** Remote link (paired phones and tablets) */
  'remote:status': () => Promise<RemoteLinkStatus>
  'session:state': () => Promise<SessionSnapshot>
  /** Which thing is holding the connections, in one word — see `@shared/holding` */
  'session:holding': () => Promise<{ holder: Holder }>
  'vault:status': () => Promise<VaultStatusInfo>
  'vault:create': (passphrase: string, keepOpen?: boolean) => Promise<VaultStatusInfo>
  'vault:unlock': (passphrase: string, keepOpen?: boolean) => Promise<VaultStatusInfo>
  'vault:lock': () => Promise<VaultStatusInfo>
  'remote:start': () => Promise<RemoteLinkStatus>
  'remote:stop': () => Promise<RemoteLinkStatus>
  'remote:start-pairing': () => Promise<RemoteLinkStatus>
  'remote:cancel-pairing': () => Promise<RemoteLinkStatus>
  'remote:revoke': (endpointId: string) => Promise<RemoteLinkStatus>
  /** Dial another Switchboard by its ticket. The code is needed the first time only. */
  'remote:dial': (ticket: string, pairingCode?: string) => Promise<{ ok: boolean; error?: string }>
  /** Stop looking for one. Not the same as revoking it. */
  'remote:forget-dialled': (ticket: string) => Promise<RemoteLinkStatus>
  /** Make each of a bouncer's networks a network here, bound by id */
  'bouncer:adopt': (serverId: string) => Promise<{ added: number }>
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
  'channel:list': (
    serverId: string
  ) => Promise<{ name: string; userCount: number; topic: string }[]>
  'message:send': (serverId: string, channel: string, text: string) => Promise<void>
  'message:reply': (
    serverId: string,
    channel: string,
    text: string,
    replyTo: string
  ) => Promise<void>
  'message:react': (
    serverId: string,
    channel: string,
    msgid: string,
    emoji: string,
    /** Take the reaction back rather than adding it */
    remove?: boolean
  ) => Promise<void>
  'message:redact': (
    serverId: string,
    channel: string,
    msgid: string,
    reason?: string
  ) => Promise<void>
  'message:edit': (
    serverId: string,
    channel: string,
    msgid: string,
    newText: string
  ) => Promise<void>
  'message:typing': (serverId: string, channel: string, status?: 'active' | 'done') => Promise<void>
  'message:search': (serverId: string, query: string, channel?: string) => Promise<ChatMessage[]>
  'user:whois': (serverId: string, nick: string) => Promise<Record<string, string>>
  'user:kick': (serverId: string, channel: string, nick: string, reason?: string) => Promise<void>
  /** One channel mode against one person: op, halfop, voice, ban, quiet */
  'user:mode': (serverId: string, channel: string, change: string, target: string) => Promise<void>
  'user:nick': (serverId: string, nick: string) => Promise<void>
  'user:setname': (serverId: string, realname: string) => Promise<void>
  'user:away': (serverId: string, message?: string) => Promise<void>
  'metadata:get': (serverId: string, target: string, key: string) => Promise<void>
  /** @param scope `global` for the profile you carry everywhere, or a serverId */
  'metadata:set': (
    scope: string,
    key: string,
    value: string
  ) => Promise<{ saved: boolean; published: boolean; reason?: string } | void>
  /** Drop this network's own profile, so it follows the one you carry again */
  'metadata:reset': (serverId: string) => Promise<void>
  /**
   * Write a conversation to a file the person picks.
   *
   * Answers with the path it wrote, or null if the dialog was dismissed. Not
   * offered to a paired device: a phone cannot be handed a file on a desktop's
   * disk, and the save dialog belongs to the window that asked.
   */
  'transcript:save': (
    serverId: string,
    channel: string
  ) => Promise<{ path: string; messages: number } | null>
  /** Files being offered, sent or received */
  'dcc:list': () => Promise<DccTransfer[]>
  /** Take a file somebody offered, into a folder the person picks */
  'dcc:accept': (id: string) => Promise<boolean>
  /** Refuse one */
  'dcc:decline': (id: string) => Promise<void>
  /** Offer a file to somebody */
  'dcc:offer': (serverId: string, nick: string) => Promise<boolean>
  /** What a channel is currently set to, as the connection has tracked it */
  'channel:modes': (serverId: string, channel: string) => Promise<Record<string, string | true>>
  /**
   * Change one of a channel's settings.
   *
   * Takes the MODE arguments as `@shared/chanmodes` produced them, rather than
   * a change and a target the way `user:mode` does — a flag has no target, and
   * sending an empty one makes `MODE #chan +m :`, which is not the command
   * anybody meant.
   */
  'channel:set-mode': (serverId: string, channel: string, args: string[]) => Promise<void>
  /** Ask the server for one of a channel's mask lists — bans and the rest */
  'masklist:fetch': (serverId: string, channel: string, mode: string) => Promise<MaskEntry[]>
  /** Everyone this client has been told not to hear from */
  'ignore:list': () => Promise<IgnoreEntry[]>
  /** Stop hearing from whoever matches this mask */
  'ignore:add': (mask: string, network: string, scope: IgnoreScope) => Promise<IgnoreEntry[]>
  /** Start hearing from them again */
  'ignore:remove': (mask: string, network: string) => Promise<IgnoreEntry[]>
  /** Add or lift one entry on one of those lists */
  'masklist:set': (
    serverId: string,
    channel: string,
    mode: string,
    mask: string,
    adding: boolean
  ) => Promise<void>
  'account:register': (serverId: string, email: string | null, password: string) => Promise<boolean>
  'account:verify': (serverId: string, account: string, code: string) => Promise<boolean>
  /**
   * Messages a paired device took while it was the connection.
   *
   * The phone keeps nothing on disk, so what it heard while this desktop was
   * off exists only in its memory until it hands it over. See
   * `src/main/storage/handover.ts`.
   */
  'history:store': (serverId: string, messages: HandoverMessage[]) => Promise<number>
  /** Everything after a moment, across every conversation — see `history:since` */
  /** Everything on the wire for a network, oldest first */
  'raw:log': (serverId: string) => Promise<RawLine[]>
  'raw:clear': (serverId: string) => Promise<void>
  'history:since': (serverId: string, after: string, limit?: number) => Promise<ChatMessage[]>
  'history:fetch': (
    serverId: string,
    channel: string,
    before?: string,
    limit?: number
  ) => Promise<ChatMessage[]>
  /** The conversation around one moment in it — see `@shared/jump` */
  'history:around': (
    serverId: string,
    channel: string,
    at: string,
    limit?: number
  ) => Promise<ChatMessage[]>
  /** Everything that named you, across every network, newest first */
  'mentions:recent': (limit?: number) => Promise<Mention[]>
  /** The same search, asked of every network at once — see `@shared/search` */
  'search:everywhere': (query: string, limit?: number) => Promise<Found[]>
  'chathistory:request': (
    serverId: string,
    channel: string,
    before?: string,
    limit?: number
  ) => Promise<void>
  /** Which conversations had traffic since `since` — the only way to find a missed DM */
  'chathistory:targets': (serverId: string, since: string) => Promise<void>
  /** What was said after `after`, for catching up on another device's evening */
  'chathistory:catchup': (
    serverId: string,
    channel: string,
    after: string,
    limit?: number
  ) => Promise<void>
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
  /** The same upload for bytes that came from the clipboard or a drop, with no path to open */
  'file:upload-bytes': (
    serverId: string,
    fileName: string,
    contentType: string,
    data: Uint8Array
  ) => Promise<{ url: string; filename: string } | null>
  'message:search-server': (serverId: string, query: string, channel?: string) => Promise<void>
  'monitor:add': (serverId: string, nicks: string[]) => Promise<void>
  'monitor:remove': (serverId: string, nicks: string[]) => Promise<void>
  'monitor:list': (serverId: string) => Promise<string[]>
  /** SHA-256 of a client certificate, as NickServ CERT ADD wants it */
  'server:certificate-fingerprint': (pem: string) => Promise<string | null>
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
