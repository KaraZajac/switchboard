import { BrowserWindow, Notification, app, net, dialog, type IpcMainInvokeEvent } from 'electron'
import { hasMetadata } from '@shared/metadata'
import { handle } from './registry'
import { readFile } from 'fs/promises'
import { userInfo } from 'os'
import { basename, extname } from 'path'
import https from 'node:https'
import http from 'node:http'
import { autoUpdater } from 'electron-updater'
import { ircManager } from '../irc/manager'
import { runCommand } from '../irc/commands'
import {
  getAllServers,
  getServer,
  addServer,
  updateServer,
  removeServer
} from '../storage/models/server'
import { getMessages, searchMessages, deleteMessage } from '../storage/models/message'
import { getSetting, setSetting } from '../storage/models/settings'
import type { ServerConfig } from '@shared/types/server'

/**
 * Where the person's profile lives, as opposed to any one network's copy.
 *
 * The same key the phone writes — `settings.profile` inside the vault — so the
 * two devices are describing the same person rather than each keeping their
 * own idea of one.
 */
const DEFAULT_PROFILE = 'profile'
import { resolveProfile, overrideFrom } from '@shared/profile'
import { secretsProtected, secretsBackendDescription } from '../storage/secrets'
import { databaseIsEncrypted } from '../storage/database'
import { serversChanged, monitorChanged, settingChanged, readMarkerChanged } from './notify'
import {
  createVault,
  lockVault,
  resealVault,
  unlockVault,
  vaultStatus,
  SHARED_SETTINGS
} from '../vault/vault'
import {
  sessionState,
  remoteStatus,
  startRemoteLink,
  stopRemoteLink,
  startPairing,
  cancelPairing,
  revokeRemoteDevice
} from '../remote/link'
import { DEFAULT_NICK } from '@shared/constants'
import { getReadMarker, setReadMarker, getAllReadMarkers } from '../storage/models/readmarker'
import { expectCleared, metadataValueFits, metadataLimitsOf } from '../irc/features/metadata'
import { friendListKind, friendListLines, friendListStatusLine } from '@shared/friends'
import { tagToUse, TAG_NAMES } from '@shared/clienttags'
import { readCertificate, certificateBody } from '@shared/certfp'
import { createHash } from 'crypto'
import { filehostUrl as filehostOf, mayAuthenticate, uploadedUrl } from '@shared/filehost'
import { dialChanged } from '@shared/dial'

/**
 * Register all IPC handlers.
 * These handle renderer → main invocations.
 */
type ChannelListEntry = { name: string; userCount: number; topic: string }

/** LIST is slow and answers once; concurrent askers share the same request. */
const channelListRequests = new Map<string, Promise<ChannelListEntry[]>>()

export function registerIPCHandlers(): void {
  // ── Server management ────────────────────────────────────────────

  handle('server:list', async () => {
    return getAllServers()
  })

  handle('app:renderer-ready', async () => {
    // The renderer is listening now, so it is safe to bring up auto-connect
    // servers. Returns whatever is already live, for a reload or a slow first
    // paint that missed the events.
    ircManager.autoConnectAll()
    return ircManager.getSnapshot()
  })

  // ── Window controls (the frame is drawn by the app itself) ───────

  // ── Remote link ─────────────────────────────────────────────────

  handle('remote:status', async () => remoteStatus())
  handle('session:state', async () => sessionState())

  handle('vault:status', async () => vaultStatus())
  handle('vault:create', async (_event, passphrase: string) => createVault(passphrase))
  handle('vault:unlock', async (_event, passphrase: string) => unlockVault(passphrase))
  handle('vault:lock', async () => lockVault())
  handle('remote:start', async () => startRemoteLink())
  handle('remote:stop', async () => stopRemoteLink())
  handle('remote:start-pairing', async () => startPairing())
  handle('remote:cancel-pairing', async () => cancelPairing())
  handle('remote:revoke', async (_event, endpointId: string) => revokeRemoteDevice(endpointId))

  handle('app:secrets-status', async () => ({
    protected: secretsProtected(),
    description: secretsBackendDescription(),
    databaseEncrypted: databaseIsEncrypted()
  }))

  handle('app:default-nick', async () => {
    // RFC 2812 nick charset; anything else in the account name is dropped
    const raw = (userInfo().username || '').replace(/[^A-Za-z0-9[\]\\`_^{|}-]/g, '')
    const nick = /^[A-Za-z[\]\\`_^{|}]/.test(raw) ? raw.slice(0, 16) : ''
    return nick || DEFAULT_NICK
  })

  // Window controls act on the window that asked. A paired device has no
  // window here, which is also why these are absent from REMOTE_ALLOWED.
  const senderWindow = (event: IpcMainInvokeEvent | null): BrowserWindow | null =>
    event ? BrowserWindow.fromWebContents(event.sender) : null

  handle('window:minimize', async (event) => {
    senderWindow(event)?.minimize()
  })

  handle('window:maximize', async (event) => {
    const window = senderWindow(event)
    if (!window) return false
    if (window.isMaximized()) {
      window.unmaximize()
      return false
    }
    window.maximize()
    return true
  })

  handle('window:close', async (event) => {
    senderWindow(event)?.close()
  })

  handle('window:is-maximized', async (event) => {
    return senderWindow(event)?.isMaximized() ?? false
  })

  handle('server:add', async (_event, config: ServerConfig) => {
    // A profile belongs to the person, not to a connection. Adding a network
    // should not mean typing your name in again, so a new one starts from the
    // saved default unless the caller brought its own.
    const stored = getSetting<Record<string, string>>(DEFAULT_PROFILE) ?? {}
    const seeded =
      config.profile && Object.keys(config.profile).length > 0
        ? config
        : { ...config, profile: stored }

    const id = addServer(seeded)
    // The vault is what the other device would connect with — keep it current
    resealVault()
    // The window keeps its own copy and updates it as it acts. This call may
    // not have come from the window: a paired phone reaches the same handler.
    serversChanged()
    return id
  })

  handle('server:update', async (_event, serverId: string, updates) => {
    const before = getServer(serverId)
    updateServer(serverId, updates)
    resealVault()
    serversChanged()

    // Where the connection goes is part of what was edited: changing the
    // address and pressing save used to leave the socket on the old server,
    // with the list showing the new address and a green dot beside it.
    // Nothing else reconnects — dropping somebody out of a conversation to
    // apply a renamed network would be worse than the bug.
    const after = getServer(serverId)
    if (before && after && dialChanged(before, after) && ircManager.getClient(serverId)) {
      ircManager.disconnect(serverId)
      ircManager.connect(after)
    }
  })

  handle('server:remove', async (_event, serverId: string) => {
    ircManager.disconnect(serverId)
    removeServer(serverId)
    resealVault()
    serversChanged()
  })

  handle('server:connect', async (_event, serverId: string) => {
    const config = getServer(serverId)
    if (!config) throw new Error(`Server ${serverId} not found`)
    ircManager.connect(config)
  })

  handle('server:disconnect', async (_event, serverId: string) => {
    ircManager.disconnect(serverId)
  })

  // ── Channel operations ───────────────────────────────────────────

  handle('channel:join', async (_event, serverId: string, channel: string, key?: string) => {
    const client = ircManager.getClient(serverId)
    if (!client) throw new Error('Not connected')
    client.join(channel, key)
  })

  handle('channel:part', async (_event, serverId: string, channel: string) => {
    const client = ircManager.getClient(serverId)
    if (!client) throw new Error('Not connected')
    client.part(channel)
  })

  handle('channel:topic', async (_event, serverId: string, channel: string, topic: string) => {
    const client = ircManager.getClient(serverId)
    if (!client) throw new Error('Not connected')
    client.setTopic(channel, topic)
  })

  handle('channel:list', async (_event, serverId: string) => {
    const client = ircManager.getClient(serverId)
    if (!client) throw new Error('Not connected')

    // One LIST at a time per server. Two callers — the window and a phone, say
    // — used to send two LISTs and race for one `channelList` event, so the
    // loser got whatever the winner had already drained: an empty list.
    const inFlight = channelListRequests.get(serverId)
    if (inFlight) return inFlight

    const request = new Promise<ChannelListEntry[]>((resolve) => {
      const finish = (channels: ChannelListEntry[]): void => {
        clearTimeout(timeout)
        client.events.off('channelList', onList)
        channelListRequests.delete(serverId)
        resolve(channels)
      }

      // A big network answers for a long time; give up rather than hang
      const timeout = setTimeout(() => finish([]), 15000)
      const onList = (channels: ChannelListEntry[]): void => finish(channels)

      client.events.on('channelList', onList)
      client.connection.send('LIST')
    })

    channelListRequests.set(serverId, request)
    return request
  })

  // ── Message operations ───────────────────────────────────────────

  handle('message:send', async (_event, serverId: string, channel: string, text: string) => {
    const client = ircManager.getClient(serverId)
    if (!client) throw new Error('Not connected')

    // Slash commands run instead of being sent — an unrecognised one must never
    // reach the channel as a message.
    const command = runCommand(client, channel, text)
    if (command.handled) {
      if (command.error) {
        client.events.emit('error', {
          code: 'COMMAND',
          command: text.split(' ')[0],
          message: command.error
        })
      }
      return
    }

    // Auto-clear away when sending a message
    if (client.state.away) {
      client.connection.send('AWAY')
    }

    const body = command.message ?? text

    // Always through here, not only for text with line breaks in it: a single
    // paragraph too long for one line also has to be cut, and where the server
    // has multiline that cut can be sent as `draft/multiline-concat` — one
    // message that had to be split, rather than two messages.
    const { sendMultilineMessage } = await import('../irc/features/multiline')
    sendMultilineMessage(client, channel, body.split('\n'))
  })

  handle('message:reply', async (_event, serverId: string, channel: string, text: string, replyTo: string) => {
    const client = ircManager.getClient(serverId)
    if (!client) throw new Error('Not connected')
    // Strip newlines to prevent IRC command injection
    const safeText = text.replace(/[\r\n]+/g, ' ')

    // Whichever spelling this network carries. FurNet allows draft/reply and
    // denies reply, which was the one we always sent — so the reply arrived as
    // an ordinary line, attached to nothing. A network that carries neither
    // still gets the message; it is the threading that is lost, not the words.
    const replyTag = tagToUse(client.state.isupport['CLIENTTAGDENY'], TAG_NAMES.reply)
    client.connection.sendRaw(
      replyTag
        ? `@+${replyTag}=${sanitizeTagValue(replyTo)} PRIVMSG ${channel} :${safeText}`
        : `PRIVMSG ${channel} :${safeText}`
    )
  })

  /**
   * React to a message, or take the reaction back.
   *
   * Both directions, because a reaction you cannot remove is a reaction nobody
   * dares add. `draft/unreact` is the other half of the same client tag.
   */
  handle(
    'message:react',
    async (
      _event,
      serverId: string,
      channel: string,
      msgid: string,
      emoji: string,
      remove = false
    ) => {
      const client = ircManager.getClient(serverId)
      if (!client) throw new Error('Not connected')

      const deny = client.state.isupport['CLIENTTAGDENY']
      const tag = tagToUse(deny, remove ? TAG_NAMES.unreact : TAG_NAMES.react)
      const replyTag = tagToUse(deny, TAG_NAMES.reply)
      // A reaction is two client tags and needs both: the emoji, and which
      // message it is about. Libera carries neither, and the TAGMSG that
      // arrived there had been stripped of everything that made it a reaction
      // — so the button appeared to work and nothing happened. Better to say.
      if (!tag || !replyTag) {
        throw new Error('This network does not carry reactions.')
      }

      client.connection.sendRaw(
        `@+${tag}=${sanitizeTagValue(emoji)};+${replyTag}=${sanitizeTagValue(msgid)} ` +
          `TAGMSG ${channel}`
      )
    }
  )

  handle('message:redact', async (_event, serverId: string, channel: string, msgid: string, reason?: string) => {
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

  handle('message:edit', async (_event, serverId: string, channel: string, msgid: string, newText: string) => {
    const client = ircManager.getClient(serverId)
    if (!client) throw new Error('Not connected')
    // Strip newlines to prevent IRC command injection
    const safeText = newText.replace(/[\r\n]+/g, ' ')
    // Send edited message with +draft/edit tag pointing to original message ID
    client.connection.sendRaw(`@+draft/edit=${sanitizeTagValue(msgid)} PRIVMSG ${channel} :${safeText}`)
  })

  handle('message:typing', async (_event, serverId: string, channel: string, status: 'active' | 'done' = 'active') => {
    const client = ircManager.getClient(serverId)
    if (!client) throw new Error('Not connected')
    // Nothing to say if the network drops it: a TAGMSG with its only tag
    // stripped is a line that means nothing to everyone who receives it.
    const typingTag = tagToUse(client.state.isupport['CLIENTTAGDENY'], TAG_NAMES.typing)
    if (!typingTag) return
    client.connection.sendRaw(
      `@+${typingTag}=${sanitizeTagValue(status)} TAGMSG ${channel}`
    )
  })

  // ── User operations ──────────────────────────────────────────────

  handle('user:whois', async (_event, serverId: string, nick: string) => {
    const client = ircManager.getClient(serverId)
    if (!client) throw new Error('Not connected')
    client.whois(nick)
    // Result comes back as irc:whois event
    return {}
  })

  handle('user:kick', async (_event, serverId: string, channel: string, nick: string, reason?: string) => {
    const client = ircManager.getClient(serverId)
    if (!client) throw new Error('Not connected')
    client.kick(channel, nick, reason)
  })

  /**
   * Give or take a channel mode against one person.
   *
   * One call for op, halfop, voice, ban and quiet alike, because they are the
   * same line on the wire — `MODE #channel +o nick` — and what may be asked
   * for is decided in `@shared/powers` rather than here. The server is still
   * the authority: this only stops a client offering what it can already tell
   * will be refused.
   */
  handle(
    'user:mode',
    async (
      _event,
      serverId: string,
      channel: string,
      change: string,
      target: string
    ) => {
      const client = ircManager.getClient(serverId)
      if (!client) throw new Error('Not connected')
      client.connection.send('MODE', channel, change, target)
    }
  )

  handle('user:nick', async (_event, serverId: string, nick: string) => {
    const client = ircManager.getClient(serverId)
    if (!client) throw new Error('Not connected')
    client.setNick(nick)
  })

  handle('user:setname', async (_event, serverId: string, realname: string) => {
    const client = ircManager.getClient(serverId)
    if (!client) throw new Error('Not connected')
    if (!client.state.capabilities.has('setname')) {
      throw new Error('Server does not support SETNAME')
    }
    client.connection.send('SETNAME', realname)
  })

  handle('user:away', async (_event, serverId: string, message?: string) => {
    const client = ircManager.getClient(serverId)
    if (!client) throw new Error('Not connected')
    if (message) {
      client.connection.send('AWAY', message)
    } else {
      client.connection.send('AWAY')
    }
  })

  // ── Metadata ────────────────────────────────────────────────────

  handle('metadata:get', async (_event, serverId: string, target: string, key: string) => {
    const client = ircManager.getClient(serverId)
    if (!client) throw new Error('Not connected')
    if (!hasMetadata(client.state.capabilities)) {
      throw new Error('Server does not support metadata')
    }
    // METADATA before 001 comes back as 451 and is lost. Say so rather than
    // sending a command that cannot work.
    if (client.state.registrationState !== 'connected') {
      throw new Error('Not registered with the server yet')
    }
    client.connection.send('METADATA', target, 'GET', key)
  })

  /**
   * Set one of your own profile keys.
   *
   * Your profile is yours, not the network's, so it is saved whatever the
   * server can carry — and published on the ones that can, now and on every
   * later connect. This used to throw on a server without `draft/metadata-2`,
   * which meant filling the form in on such a network threw the answers away.
   *
   * Answers rather than throws, because "saved but not published" is the
   * common case and is not a failure the caller should have to infer from an
   * exception.
   */
  /**
   * Change one field of a profile.
   *
   * @param scope `global` for the profile you carry everywhere, or a serverId
   *   for one network only.
   *
   * These used to be the same write: editing a profile anywhere set the
   * network's copy *and* the default, so you could not be called something
   * different in one place without changing what you were called in all of
   * them — and changing the default left every other network on the frozen
   * copy it was seeded with.
   */
  handle('metadata:set', async (_event, scope: string, key: string, value: string) => {
    // Alphanumeric and dashes only — no spaces, no protocol characters
    if (!/^[a-zA-Z0-9_-]+$/.test(key)) throw new Error('Invalid metadata key')

    const global: Record<string, string> = {
      ...(getSetting<Record<string, string>>(DEFAULT_PROFILE) ?? {})
    }

    if (scope === 'global') {
      if (value) global[key] = value
      else delete global[key]
      setSetting(DEFAULT_PROFILE, global)

      // Every network that is not saying something else about this field is
      // describing you, so they all say the new thing now rather than at their
      // next reconnect.
      //
      // Per field, not per network: an override is field by field, so a
      // network you gave a different display name still follows your pronouns
      // — and skipping the whole network meant it followed them only until the
      // next time anybody looked.
      let published = false
      for (const server of getAllServers()) {
        if ((server.profile ?? {})[key as keyof typeof server.profile] !== undefined) continue
        const client = ircManager.getClient(server.id)
        if (!client) continue
        ircManager.refreshProfile(client)
        if (hasMetadata(client.state.capabilities)) published = true
      }
      resealVault()

      // Saved either way — a profile is a thing about you, not about a
      // network — but say so when there is nowhere it can be seen.
      return {
        saved: true,
        published,
        reason: published ? undefined : 'Saved. No connected network here can show it to anyone'
      }
    }

    const serverId = scope
    const config = getServer(serverId)
    if (!config) throw new Error(`Server ${serverId} not found`)

    // Stored as a difference from your profile rather than a copy of it, so a
    // network only stops following you where somebody meant it to.
    const typed: Record<string, string> = {
      ...resolveProfile(global, config.profile)
    }
    if (value) typed[key] = value
    else typed[key] = ''
    const profile = overrideFrom(global, typed) ?? {}
    updateServer(serverId, { profile })

    // The avatar has a column of its own, from before profiles were a thing
    if (key === 'avatar') updateServer(serverId, { avatarUrl: value || null })

    // Keep the other device's copy in step
    resealVault()

    const client = ircManager.getClient(serverId)
    if (client && key === 'avatar') client.config.avatarUrl = value || null
    if (client) {
      client.config.profile = profile as typeof client.config.profile

      // Reflect it back to both windows now, rather than waiting for a server
      // echo that may be wrong or may never come.
      const own = client.state.nick.toLowerCase()
      const mine: Record<string, string> = { ...(client.state.metadata.get(own) ?? {}) }
      if (value) mine[key] = value
      else delete mine[key]
      if (Object.keys(mine).length > 0) client.state.metadata.set(own, mine)
      else client.state.metadata.delete(own)

      ircManager.announceMetadata(serverId, client.state.nick, key, value)
    }

    if (!client) return { saved: true, published: false, reason: 'Not connected' }
    if (!hasMetadata(client.state.capabilities)) {
      return {
        saved: true,
        published: false,
        reason: 'This network does not support profiles, so nobody here will see it'
      }
    }

    if (value && !metadataValueFits(client, value)) {
      const limit = metadataLimitsOf(client).maxValueBytes
      return {
        saved: true,
        published: false,
        reason: `This network keeps at most ${limit} bytes per field, and that one is longer`
      }
    }

    if (!value) {
      // Clearing a key means leaving the value off entirely. Sending an empty
      // one — `METADATA * SET pronouns ` — is a malformed line, and servers
      // are entitled to make of it what they like.
      expectCleared(client, key)
      client.connection.send('METADATA', '*', 'SET', key)
    } else if (value.includes(' ') || value.startsWith(':')) {
      // sendRaw rather than the serializer: some servers store the trailing ':'
      // as part of the value
      client.connection.sendRaw(`METADATA * SET ${key} :${value}`)
    } else {
      client.connection.sendRaw(`METADATA * SET ${key} ${value}`)
    }
    return { saved: true, published: true }
  })

  /**
   * Give this network back the profile you carry.
   *
   * The counterpart to editing one field of a network's own profile: there has
   * to be a way out of having one, and typing your global values back in field
   * by field until the difference disappears is not it.
   */
  handle('metadata:reset', async (_event, serverId: string) => {
    const config = getServer(serverId)
    if (!config) throw new Error(`Server ${serverId} not found`)

    updateServer(serverId, { profile: {} })
    resealVault()

    const client = ircManager.getClient(serverId)
    if (!client) return
    client.config.profile = {}
    // Republishing is what clears the fields this network had of its own:
    // `publishProfile` sends a valueless SET for anything it is no longer
    // saying, so the old display name goes rather than lingering.
    ircManager.refreshProfile(client)
  })

  /**
   * Ask for one of a channel's mask lists.
   *
   * Answers with what is already known and asks the server in the background,
   * because a ban list is sent as hundreds of separate numerics and waiting
   * for the last one before showing anything means a panel that is empty for
   * a second every time it opens. The `irc:masklist` event fills it in.
   */
  handle('masklist:fetch', async (_event, serverId: string, channel: string, mode: string) => {
    const client = ircManager.getClient(serverId)
    if (!client) return []

    const ch = client.state.channels.get(client.state.casemap(channel))
    if (!ch) return []

    // Asking again while an answer is still arriving would interleave two
    // copies of the same list.
    if (!ch.loadingLists.has(mode)) {
      ch.loadingLists.add(mode)
      client.connection.send('MODE', channel, `+${mode}`)
    }
    return ch.maskLists.get(mode) ?? []
  })

  /**
   * Put something on one of those lists, or take it off.
   *
   * No privilege check here: the server is the authority on that and will say
   * 482 if we are wrong. The check that matters is in the UI, which does not
   * offer the button at all where `actionsFor` says it would fail.
   */
  handle(
    'masklist:set',
    async (
      _event,
      serverId: string,
      channel: string,
      mode: string,
      mask: string,
      adding: boolean
    ) => {
      const client = ircManager.getClient(serverId)
      if (!client) throw new Error('Not connected to this network')
      if (!mask.trim()) throw new Error('Nothing to set')

      client.connection.send('MODE', channel, `${adding ? '+' : '-'}${mode}`, mask.trim())
    }
  )

  // ── History ──────────────────────────────────────────────────────

  handle('history:fetch', async (_event, serverId: string, channel: string, before?: string, limit?: number) => {
    return getMessages(serverId, channel, { before, limit })
  })

  /**
   * What was said after the newest thing we have.
   *
   * The other half of `chathistory:request`, and the half that makes two
   * devices work: local history is what this machine saw, and the whole point
   * of the second device is that things happen while this one is closed. Asking
   * BEFORE only ever reaches further back into what we already missed nothing
   * of.
   */
  /**
   * Which conversations had traffic while this device was closed.
   *
   * Channels look after themselves: rejoining one asks for its history. A DM
   * does not — nobody joins anything, so a message from somebody this client
   * has never spoken to leaves no trace at all for a client that was not
   * connected to see it arrive.
   */
  handle('chathistory:targets', async (_event, serverId: string, since: string) => {
    const client = ircManager.getClient(serverId)
    if (!client) return
    const { requestChathistoryTargets } = await import('../irc/features/chathistory')
    requestChathistoryTargets(client, `timestamp=${since}`, `timestamp=${new Date().toISOString()}`, 50)
  })

  handle('chathistory:catchup', async (_event, serverId: string, channel: string, after: string, limit?: number) => {
    const client = ircManager.getClient(serverId)
    if (!client) return
    const { requestChathistory } = await import('../irc/features/chathistory')
    requestChathistory(client, channel, {
      direction: 'AFTER',
      reference: `timestamp=${after}`,
      limit: limit || 100
    })
  })

  handle('chathistory:request', async (_event, serverId: string, channel: string, before?: string, limit?: number) => {
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

  handle('account:register', async (_event, serverId: string, email: string | null, password: string) => {
    const client = ircManager.getClient(serverId)
    if (!client) throw new Error('Not connected')
    const { registerAccount } = await import('../irc/features/account-registration')
    return registerAccount(client, email, password)
  })

  handle('account:verify', async (_event, serverId: string, account: string, code: string) => {
    const client = ircManager.getClient(serverId)
    if (!client) throw new Error('Not connected')
    const { verifyAccount } = await import('../irc/features/account-registration')
    return verifyAccount(client, account, code)
  })

  // ── Search ──────────────────────────────────────────────────

  handle('message:search', async (_event, serverId: string, query: string, channel?: string) => {
    return searchMessages(serverId, query, { channel, limit: 50 })
  })

  handle('message:search-server', async (_event, serverId: string, query: string, channel?: string) => {
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

  handle('notification:send', async (_event, title: string, body: string) => {
    if (Notification.isSupported()) {
      const notification = new Notification({ title, body, silent: false })
      notification.show()
    }
  })

  handle('tray:set-badge', async (_event, count: number) => {
    if (process.platform === 'darwin') {
      app.dock?.setBadge(count > 0 ? count.toString() : '')
    }
  })

  // ── Auto-update ────────────────────────────────────────────────

  handle('updater:install', async () => {
    autoUpdater.quitAndInstall(false, true)
  })

  handle('updater:check', async () => {
    if (!app.isPackaged) return { available: false }
    const result = await autoUpdater.checkForUpdates()
    return { available: !!result?.updateInfo, version: result?.updateInfo?.version }
  })

  // ── Settings ─────────────────────────────────────────────────────

  handle('settings:get', async (_event, key: string) => {
    return getSetting(key)
  })

  handle('settings:set', async (_event, key: string, value: unknown) => {
    setSetting(key, value)
    // May not have come from the window: a paired phone picking a theme
    // reaches the same handler, and the two are meant to match.
    settingChanged(key)
    // And the other device is not necessarily attached right now, so the
    // durable copy has to move too, not just the live signal.
    if ((SHARED_SETTINGS as readonly string[]).includes(key)) resealVault()
  })

  // ── Read markers ─────────────────────────────────────────────────

  handle('read-marker:set', async (_event, serverId: string, channel: string, timestamp: string) => {
    // Persist locally
    setReadMarker(serverId, channel, timestamp)

    // Sync with server if supported
    const client = ircManager.getClient(serverId)
    if (client && client.state.capabilities.has('draft/read-marker')) {
      client.connection.send('MARKREAD', channel, `timestamp=${timestamp}`)
      // The server will echo it, and the window hears about it that way.
      return
    }

    // Without the capability there is no echo, so this is the only way the
    // window learns the phone has read a conversation.
    readMarkerChanged(serverId, channel, timestamp)
  })

  handle('read-marker:get', async (_event, serverId: string, channel: string) => {
    return getReadMarker(serverId, channel)
  })

  handle('read-marker:get-all', async (_event, serverId: string) => {
    return getAllReadMarkers(serverId)
  })

  // ── Monitor (friend list) ──────────────────────────────────────────

  handle('monitor:add', async (_event, serverId: string, nicks: string[]) => {
    const { addToMonitorList } = await import('../storage/models/monitor')
    addToMonitorList(serverId, nicks)
    const client = ircManager.getClient(serverId)
    if (client) {
      const kind = friendListKind(client.state.isupport)
      // Nothing to send on a network that offers neither command. The name is
      // still saved: it goes to the server the moment we are on one that does.
      if (kind) {
        for (const line of friendListLines(kind, nicks, 'add')) client.connection.sendRaw(line)
      }
    }
    // The server echoes who is online, never who is on the list
    monitorChanged(serverId)
    // MONITOR is per connection: the other device has to be handed the list,
    // because there is nothing it can ask the server for.
    resealVault()
  })

  handle('monitor:remove', async (_event, serverId: string, nicks: string[]) => {
    const { removeFromMonitorList } = await import('../storage/models/monitor')
    removeFromMonitorList(serverId, nicks)
    const client = ircManager.getClient(serverId)
    if (client) {
      const kind = friendListKind(client.state.isupport)
      if (kind) {
        for (const line of friendListLines(kind, nicks, 'remove')) client.connection.sendRaw(line)
      }
    }
    monitorChanged(serverId)
    resealVault()
  })

  /**
   * The fingerprint a network's services want for this certificate.
   *
   * SHA-256 of the certificate in DER, lowercase hex — the string that goes to
   * `NickServ CERT ADD`. Working it out is most of why nobody uses CertFP:
   * every guide ends in an openssl incantation whose output you are then meant
   * to paste somewhere else.
   */
  handle('server:certificate-fingerprint', async (_event, pem: string) => {
    const identity = readCertificate(pem)
    if (!identity) return null

    const der = Buffer.from(certificateBody(identity.certificate), 'base64')
    if (der.length === 0) return null

    try {
      return createHash('sha256').update(der).digest('hex')
    } catch {
      return null
    }
  })

  handle('monitor:list', async (_event, serverId: string) => {
    const { getMonitorList } = await import('../storage/models/monitor')
    return getMonitorList(serverId)
  })

  handle('monitor:status', async (_event, serverId: string) => {
    const client = ircManager.getClient(serverId)
    if (client) {
      const kind = friendListKind(client.state.isupport)
      if (kind) client.connection.sendRaw(friendListStatusLine(kind))
    }
  })

  // ── File upload (draft/FILEHOST) ────────────────────────────────────

  handle('file:upload', async (_event, serverId: string) => {
    const client = ircManager.getClient(serverId)
    if (!client) throw new Error('Not connected')

    const filehostUrl = filehostOf(client.state.isupport)
    if (!filehostUrl) throw new Error('Server does not support file uploads')

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

    // The account password, but only where the connection to the filehost is
    // itself encrypted. The upload authenticates with Basic, and over plain
    // http that hands the password to anyone on the path — and unlike the IRC
    // connection, this URL is whatever the server said it was.
    const config = getServer(serverId)
    if (config?.saslUsername && config?.saslPassword && mayAuthenticate(filehostUrl)) {
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
          // The draft allows a relative Location, and a relative one pasted
          // into a channel is a link to nothing
          const resolved = uploadedUrl(typeof loc === 'string' ? loc : null, filehostUrl)
          if (!resolved) {
            reject(new Error('Server did not return a usable file URL'))
            return
          }
          resolve(resolved)
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

  handle('link-preview:fetch', async (_event, url: string) => {
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

      const titleTag = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim()
      const title = get('title') || (titleTag ? decodeHTMLEntities(titleTag) : undefined)
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

      // Some sites suppress the favicon request with `<link rel=icon href="data:,">`.
      // Passing that on leaves a blank image slot in the preview, which reads as
      // a failed load rather than a site that chose not to have one.
      if (favicon && /^data:[^,]*,\s*$/i.test(favicon)) favicon = undefined

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

/** The named entities that actually turn up in page titles and descriptions */
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  mdash: '\u2014',
  ndash: '\u2013',
  hellip: '\u2026',
  lsquo: '\u2018',
  rsquo: '\u2019',
  ldquo: '\u201c',
  rdquo: '\u201d',
  laquo: '\u00ab',
  raquo: '\u00bb',
  bull: '\u2022',
  middot: '\u00b7',
  times: '\u00d7',
  copy: '\u00a9',
  reg: '\u00ae',
  trade: '\u2122',
  deg: '\u00b0',
  euro: '\u20ac',
  pound: '\u00a3',
  hyphen: '-'
}

function decodeHTMLEntities(str: string): string {
  // One pass, so an escaped entity (&amp;lt;) does not decode twice
  return str.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (match, entity: string) => {
    if (entity.startsWith('#x') || entity.startsWith('#X')) {
      const code = parseInt(entity.slice(2), 16)
      return Number.isFinite(code) ? String.fromCodePoint(code) : match
    }
    if (entity.startsWith('#')) {
      const code = parseInt(entity.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : match
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? match
  })
}
