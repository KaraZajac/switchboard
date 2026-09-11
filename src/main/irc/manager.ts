import { BrowserWindow } from 'electron'
import { hasMetadata } from '@shared/metadata'
import { canShareConnection } from '@shared/accounts'
import { foldCase } from '@shared/casemap'
import type { ServerConfig } from '@shared/types/server'
import type { IRCMessage } from '@shared/types/irc'
import type { ChatMessage } from '@shared/types/message'
import type { ConnectionSnapshot } from '@shared/types/ipc'
import { IRCClient } from './client'
import { storeMessage, deleteMessage, editStoredMessage } from '../storage/models/message'
import { setReaction } from '../storage/models/reaction'
import { getMonitorList } from '../storage/models/monitor'
import { getAllServers, getServer, updateServer } from '../storage/models/server'
import { getJoinedChannels, markChannelJoined, markChannelParted } from '../storage/models/channel'
import { subscribeToMetadata, metadataValueFits } from './features/metadata'
import { serversChanged } from '../ipc/notify'
import { METADATA_KEYS, type UserMetadata } from '@shared/types/metadata'
import { v4 as uuid } from 'uuid'
import { friendListKind, friendListLines, friendListStatusLine } from '@shared/friends'
import { resolveProfile, keysToClear } from '@shared/profile'
import { getSetting } from '../storage/models/settings'

/** The vault key both clients keep the person's own profile under */
const DEFAULT_PROFILE = 'profile'
import { avatarUrl } from '@shared/avatar'

/**
 * Manages all IRC client connections and bridges events to the renderer.
 */
export class IRCManager {
  private clients = new Map<string, IRCClient>()
  private mainWindow: BrowserWindow | null = null
  private autoConnected = false
  private eventSubscribers = new Set<(channel: string, data: unknown) => void>()
  /** Servers we disconnected because another device took over */
  private released: string[] = []

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

    // Rejoin whatever we were in last time, on top of the configured auto-join.
    // Registration already knows how to join this list (including the delay for
    // an identify command), so merge rather than joining separately.
    const remembered = getJoinedChannels(config.id)
    // Folded with the default mapping: this runs before there is a connection
    // to ask, and it is only deduplicating a list of channel names.
    const known = new Set(config.autoJoin.map((name) => foldCase(name)))
    const autoJoin = [...config.autoJoin, ...remembered.filter((n) => !known.has(foldCase(n)))]

    const client = new IRCClient({ ...config, autoJoin })
    this.clients.set(config.id, client)
    this.bindClientEvents(config.id, client)
    client.connect()
  }

  /**
   * Remember, in the server's config, that we are in this channel.
   *
   * `markChannelJoined` already keeps a local list, but local is the problem:
   * the phone reads its channels out of the shared vault and never sees that
   * table, so a channel joined here was one the phone did not rejoin. The
   * config is what both clients read, so the config is where it belongs.
   *
   * Skipped when it is already listed, so reconnecting to a server with twelve
   * auto-join channels does not write the config twelve times.
   */
  private rememberJoin(serverId: string, channel: string): void {
    const config = getServer(serverId)
    if (!config) return
    if (config.autoJoin.some((name) => foldCase(name) === foldCase(channel))) return

    updateServer(serverId, { autoJoin: [...config.autoJoin, channel] })
    serversChanged()
  }

  /**
   * And that we are not.
   *
   * Parting is how someone says they are done with a channel; there is no other
   * signal. A kick is not one — being thrown out is not a decision to leave,
   * and quietly un-listing the channel would make somebody else's ban stick.
   */
  private forgetJoin(serverId: string, channel: string): void {
    const config = getServer(serverId)
    if (!config) return
    if (!config.autoJoin.some((name) => foldCase(name) === foldCase(channel))) return

    updateServer(serverId, {
      autoJoin: config.autoJoin.filter((name) => foldCase(name) !== foldCase(channel))
    })
    serversChanged()
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
   * Connect every server marked auto-connect. Runs at most once per app launch.
   *
   * Called when the renderer signals it is listening, so the burst of events a
   * fresh connection produces (connected, join, names) is not emitted into a
   * window that has no listeners yet — which left the UI showing "Not connected"
   * over a perfectly live socket.
   */
  autoConnectAll(): void {
    if (this.autoConnected) return
    this.autoConnected = true

    for (const server of getAllServers()) {
      if (server.autoConnect) {
        this.connect(server)
      }
    }
  }

  /**
   * Give up the IRC connections because another device is taking over.
   *
   * The server list is remembered rather than forgotten, so handing back is a
   * matter of reconnecting the same set — the user should not have to do
   * anything when their desktop wakes up.
   */
  releaseConnections(): void {
    // All but the shared ones. On a network that lets both devices on at once
    // there is nothing to hand over: the other device has its own socket beside
    // ours, and dropping ours would take this desktop off a network it is
    // perfectly able to stay on — which is the whole thing being on both
    // devices was for.
    const shared = new Set(
      getAllServers()
        .filter((server) => canShareConnection(server))
        .map((server) => server.id)
    )

    this.released = [...this.clients.keys()].filter((serverId) => !shared.has(serverId))
    for (const serverId of this.released) {
      this.disconnect(serverId)
    }

    const kept = this.clients.size
    console.info(
      `Released ${this.released.length} connection(s) to another device` +
        (kept > 0 ? `; kept ${kept} the other device can share` : '')
    )
  }

  /**
   * Take the connections back (or open them for the first time).
   *
   * Skips anything already connected. This runs whenever this device becomes
   * primary — including the very first time the remote link is switched on,
   * when every server is typically connected already — and reconnecting those
   * would drop the user off the network and bring them back under a `nick_`
   * the server hands out because their real one is still in the ping timeout.
   */
  /** The networks this device is holding, for a peer deciding what to take over */
  connectedServerIds(): string[] {
    return [...this.clients.keys()]
  }

  /**
   * Take the connections back.
   *
   * @param alsoWanted what a peer said it was holding. A desktop that handed
   *   over and then restarted has no `released` list of its own — it is in
   *   memory — and falling through to `autoConnect` dialled nothing, because
   *   that setting answers "connect on launch" rather than "this network is in
   *   use". The phone released its connection to a desktop that then sat there
   *   saying "Not connected", and the conversation was simply over.
   */
  resumeConnections(alsoWanted: string[] = []): void {
    const released = this.released
    this.released = []

    const asked = [...new Set([...released, ...alsoWanted])]
    const wanted =
      asked.length > 0
        ? asked
        : getAllServers()
            .filter((server) => server.autoConnect)
            .map((server) => server.id)

    let resumed = 0
    for (const serverId of wanted) {
      if (this.clients.has(serverId)) continue
      const config = getAllServers().find((server) => server.id === serverId)
      if (!config) continue
      this.connect(config)
      resumed++
    }

    this.autoConnected = true
    if (resumed > 0) console.info(`Resumed ${resumed} connection(s)`)
  }

  /**
   * Live state of every registered connection, for a renderer that attached late
   * or reloaded and so missed the events that would have built this state.
   */
  /**
   * Tell both windows about a metadata change we made ourselves.
   *
   * The same event a server echo produces, so nothing downstream needs to know
   * which of the two it was.
   */
  announceMetadata(serverId: string, target: string, key: string, value: string): void {
    this.send('irc:metadata', { serverId, target, key, value })
  }

  getSnapshot(): ConnectionSnapshot[] {
    const snapshot: ConnectionSnapshot[] = []

    for (const [serverId, client] of this.clients) {
      if (client.state.registrationState !== 'connected') continue

      snapshot.push({
        serverId,
        nick: client.state.nick,
        account: client.state.account,
        capabilities: Array.from(client.state.capabilities),
        capabilityValues: Object.fromEntries(
          Array.from(client.state.availableCapabilities).map(([name, value]) => [name, value ?? ''])
        ),
        metadata: Object.fromEntries(client.state.metadata),
        // A following phone decides its member menu from PREFIX and CHANMODES
        // like the desktop does, and has no connection of its own to ask.
        isupport: Object.fromEntries(
          Object.entries(client.state.isupport).map(([k, v]) => [k, v === true ? '' : v])
        ),
        channels: Array.from(client.state.channels.values()).map((channel) => ({
          name: channel.name,
          topic: channel.topic,
          topicSetBy: channel.topicSetBy,
          users: Array.from(channel.users.values())
        }))
      })
    }

    return snapshot
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

  /**
   * Watch every event the UI receives.
   *
   * Paired devices are second renderers: they need the same stream of joins,
   * messages and status changes the desktop window gets, from the same place,
   * so the two cannot drift.
   */
  subscribe(listener: (channel: string, data: unknown) => void): () => void {
    this.eventSubscribers.add(listener)
    return () => {
      this.eventSubscribers.delete(listener)
    }
  }

  private send(channel: string, data: unknown): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(channel, data)
    }
    for (const listener of this.eventSubscribers) {
      try {
        listener(channel, data)
      } catch (err) {
        console.error('A remote event listener threw:', err)
      }
    }
  }

  /**
   * Subscribe to the metadata keys we render, and publish our own profile.
   *
   * Metadata does not survive a disconnect on most servers, so what is saved
   * locally is the source of truth and goes up on every connect. Subscribing
   * first means the server then pushes other people's values for the channels
   * we are in, rather than us asking nick by nick.
   */
  /**
   * Say again who you are, because what you carry everywhere has changed.
   *
   * Called for every network that has no profile of its own when the global
   * one is edited. Without it, changing your name changed it on the network
   * you happened to be looking at and nowhere else until a reconnect.
   */
  refreshProfile(client: IRCClient): void {
    this.publishProfile(client)
  }

  private publishProfile(client: IRCClient): void {
    // Your profile, with whatever this network was given of its own laid over
    // it. A network with nothing of its own follows you everywhere; one with a
    // profile of its own differs only in what it names — see `@shared/profile`.
    const profile: UserMetadata = {
      ...(client.config.avatarUrl ? { avatar: client.config.avatarUrl } : {}),
      ...resolveProfile(getSetting<UserMetadata>(DEFAULT_PROFILE), client.config.profile)
    }

    // What we last put up here and are no longer saying. Clearing a field has
    // to be published too: a `SET` with no value is how metadata is deleted,
    // and without it, deleting your display name left every network still
    // calling you by it until something reconnected — and on a server that
    // keeps metadata across sessions, for good.
    const own = client.state.casemap(client.state.nick)
    const known = client.state.metadata.get(own) ?? {}
    const stale = keysToClear(METADATA_KEYS, known, profile)

    // Show it to ourselves whatever the network can carry.
    //
    // Otherwise you set a display name, and every window — this one and the
    // phone's — keeps calling you by your nick, because the only source of a
    // rendered name was the server echoing it back. A server without
    // `draft/metadata-2` never will, and one that has it may not until it
    // feels like it.
    const seeded: Record<string, string> = { ...known }
    for (const key of stale) delete seeded[key]
    for (const [key, value] of Object.entries(profile)) {
      if (value) seeded[key] = value
    }
    if (Object.keys(seeded).length > 0) client.state.metadata.set(own, seeded)
    else client.state.metadata.delete(own)

    // Both windows, now, rather than on the echo — which for a cleared key on
    // a server without metadata is never.
    const serverId = client.config.id
    for (const key of stale) this.announceMetadata(serverId, client.state.nick, key, '')
    for (const [key, value] of Object.entries(profile)) {
      if (value) this.announceMetadata(serverId, client.state.nick, key, value)
    }

    if (!hasMetadata(client.state.capabilities)) return

    subscribeToMetadata(client)

    for (const key of stale) client.connection.send('METADATA', '*', 'SET', key)
    for (const [key, value] of Object.entries(profile)) {
      if (!value) continue
      // Over the server's limit is refused outright, and one refused key must
      // not take the rest of the profile with it.
      if (!metadataValueFits(client, value)) continue
      client.connection.send('METADATA', '*', 'SET', key, value)
    }
  }

  private bindClientEvents(serverId: string, client: IRCClient): void {
    // Connection events
    client.events.on('registered', (data) => {
      // The account too. SASL finishes before registration does, so by now we
      // know it — and a phone following this desktop reads its own account
      // from here. Leaving it out meant the 900 that had just told it who it
      // was got overwritten with nothing a moment later.
      this.send('irc:connected', { serverId, nick: data.nick, account: client.state.account })

      // After 001, not at the end of capability negotiation. With SASL in play
      // the two are seconds apart, and anything sent in between comes back as
      // 451 ERR_NOTREGISTERED — so the profile silently never gets published
      // for exactly the users who have an account.
      this.publishProfile(client)

      // Re-send the friend list on connect, in whichever of the two commands
      // this network takes. It lives on the connection and dies with it.
      const monitorNicks = getMonitorList(serverId)
      const kind = friendListKind(client.state.isupport)
      if (monitorNicks.length > 0 && kind) {
        for (const line of friendListLines(kind, monitorNicks, 'add')) {
          client.connection.sendRaw(line)
        }
        // Request current status
        client.connection.sendRaw(friendListStatusLine(kind))
      }
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
      if (data.isMe) {
        markChannelJoined(serverId, data.channel)
        this.rememberJoin(serverId, data.channel)
      }
      this.send('irc:join', {
        serverId,
        channel: data.channel,
        user: data.user,
        isMe: data.isMe
      })
    })

    client.events.on('part', (data) => {
      if (data.isMe) {
        markChannelParted(serverId, data.channel)
        this.forgetJoin(serverId, data.channel)
      }
      this.send('irc:part', {
        serverId,
        channel: data.channel,
        nick: data.nick,
        reason: data.reason,
        isMe: data.isMe
      })
    })

    client.events.on('kick', (data) => {
      if (data.isMe) {
        markChannelParted(serverId, data.channel)
      }
      this.send('irc:kick', {
        serverId,
        channel: data.channel,
        nick: data.nick,
        by: data.by,
        reason: data.reason,
        isMe: data.isMe
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

    // The lists a channel keeps — bans and the rest. Sent whole rather than a
    // line at a time: a busy channel's ban list is hundreds of entries, and
    // an event each would be hundreds of renders for one glance at a panel.
    client.events.on('masklist', (data) => {
      this.send('irc:masklist', {
        serverId,
        channel: data.channel,
        mode: data.mode,
        entries: data.entries,
        done: data.done
      })
    })

    // Invite notifications
    client.events.on('invite', (data) => {
      if (data.isMe) {
        this.send('irc:invite', { serverId, channel: data.channel, by: data.by })
      }
    })

    // Message events
    client.events.on('privmsg', (data) => {
      // Handle message edits (draft/edit spec)
      if (data.editOf) {
        // Keep it, or the next restart quietly undoes it
        editStoredMessage(data.editOf, data.content, data.time)
        this.send('irc:edit', {
          serverId,
          channel: data.channel,
          originalId: data.editOf,
          newContent: data.content,
          editedAt: data.time
        })
        return
      }

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
        oper: (data.oper as string | null) ?? null,
        relayedBy: (data.relayedBy as string | null) ?? null,
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

    client.events.on(
      'react',
      (data: {
        channel: string
        nick: string
        emoji: string
        msgid: string
        removed: boolean
      }) => {
        // Parsed and then dropped before this: the reaction reached the client
        // and stopped there, so nothing ever showed one — on either client.
        //
        // Kept, too. A reaction that vanishes on the next restart is not really
        // on the message; it was on the screen.
        setReaction(serverId, data.channel, data.msgid, data.emoji, data.nick, data.removed)
        this.send('irc:react', { serverId, ...data })
      }
    )

    client.events.on('redact', (data: { channel: string; msgid: string; nick: string; reason: string | null }) => {
      // Delete from local database
      deleteMessage(data.msgid)
      this.send('irc:redact', { serverId, channel: data.channel, msgid: data.msgid })
    })

    client.events.on('webpush', (data) => {
      this.send('irc:webpush', { serverId, ...data })
    })

    /**
     * A conversation that had traffic while this device was closed.
     *
     * Channels take care of themselves — rejoining one asks for its history.
     * A DM does not: nobody joins anything, so a message from somebody new
     * leaves no trace at all for a client that was not connected to see it.
     */
    client.events.on('chathistoryTarget', (data: { target: string; timestamp: string }) => {
      this.send('irc:chathistory-target', { serverId, ...data })
    })

    client.events.on('accountVerified', (data) => {
      this.send('irc:verify', { serverId, status: 'SUCCESS', ...data })
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

    // Account registration. `status` rides along because "registered" and
    // "registered, now send the code from your email" are different outcomes,
    // and a client shown only the first stops halfway through.
    client.events.on(
      'accountRegistered',
      (data: { status: string; account: string; message: string }) => {
        this.send('irc:account-registered', { serverId, ...data })
      }
    )

    // Channel rename
    client.events.on('channelRename', (data: { oldName: string; newName: string; reason: string | null }) => {
      this.send('irc:channel-rename', { serverId, ...data })
    })

    // Chathistory batch (including draft/event-playback events)
    client.events.on('chathistoryBatch', (data: { target: string; messages: IRCMessage[] }) => {
      const chatMessages: ChatMessage[] = data.messages
        .filter((m) => m.command === 'PRIVMSG' || m.command === 'NOTICE' ||
          m.command === 'JOIN' || m.command === 'PART' || m.command === 'QUIT' ||
          m.command === 'NICK' || m.command === 'TOPIC' || m.command === 'KICK')
        .map((m) => {
          const timestamp = typeof m.tags['time'] === 'string' ? m.tags['time'] : new Date().toISOString()
          const nick = m.source?.nick || ''

          // Event-playback: convert channel events to system messages
          if (m.command === 'JOIN') {
            return {
              id: typeof m.tags['msgid'] === 'string' ? m.tags['msgid'] : uuid(),
              serverId, channel: data.target, nick: '', userHost: null,
              content: `${nick} joined the channel`,
              type: 'system' as const, tags: {}, replyTo: null, timestamp,
              account: null, pending: false, reactions: {}, channelContext: null
            }
          }
          if (m.command === 'PART') {
            const reason = m.params[1] ? ` (${m.params[1]})` : ''
            return {
              id: typeof m.tags['msgid'] === 'string' ? m.tags['msgid'] : uuid(),
              serverId, channel: data.target, nick: '', userHost: null,
              content: `${nick} left the channel${reason}`,
              type: 'system' as const, tags: {}, replyTo: null, timestamp,
              account: null, pending: false, reactions: {}, channelContext: null
            }
          }
          if (m.command === 'QUIT') {
            const reason = m.params[0] ? ` (${m.params[0]})` : ''
            return {
              id: typeof m.tags['msgid'] === 'string' ? m.tags['msgid'] : uuid(),
              serverId, channel: data.target, nick: '', userHost: null,
              content: `${nick} quit${reason}`,
              type: 'system' as const, tags: {}, replyTo: null, timestamp,
              account: null, pending: false, reactions: {}, channelContext: null
            }
          }
          if (m.command === 'NICK') {
            return {
              id: typeof m.tags['msgid'] === 'string' ? m.tags['msgid'] : uuid(),
              serverId, channel: data.target, nick: '', userHost: null,
              content: `${nick} is now known as ${m.params[0]}`,
              type: 'system' as const, tags: {}, replyTo: null, timestamp,
              account: null, pending: false, reactions: {}, channelContext: null
            }
          }
          if (m.command === 'TOPIC') {
            return {
              id: typeof m.tags['msgid'] === 'string' ? m.tags['msgid'] : uuid(),
              serverId, channel: data.target, nick: '', userHost: null,
              content: `${nick} changed the topic to: ${m.params[1] || ''}`,
              type: 'system' as const, tags: {}, replyTo: null, timestamp,
              account: null, pending: false, reactions: {}, channelContext: null
            }
          }
          if (m.command === 'KICK') {
            const reason = m.params[2] ? ` (${m.params[2]})` : ''
            return {
              id: typeof m.tags['msgid'] === 'string' ? m.tags['msgid'] : uuid(),
              serverId, channel: data.target, nick: '', userHost: null,
              content: `${m.params[1]} was kicked by ${nick}${reason}`,
              type: 'system' as const, tags: {}, replyTo: null, timestamp,
              account: null, pending: false, reactions: {}, channelContext: null
            }
          }

          // Regular PRIVMSG/NOTICE
          const text = m.params[1] || ''
          const isAction = text.startsWith('\x01ACTION ') && text.endsWith('\x01')
          const content = isAction ? text.slice(8, -1) : text

          const msg: ChatMessage = {
            id: (typeof m.tags['msgid'] === 'string' ? m.tags['msgid'] : uuid()),
            serverId,
            channel: data.target,
            nick,
            userHost: m.source ? `${m.source.user || ''}@${m.source.host || ''}` : null,
            content,
            type: isAction ? 'action' : m.command === 'NOTICE' ? 'notice' : 'privmsg',
            tags: m.tags as Record<string, string>,
            replyTo: typeof m.tags['+reply'] === 'string' ? m.tags['+reply'] : null,
            timestamp,
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
      // The values as well as the names. The names answer "is this supported";
      // the values answer everything else — whether registering an account
      // needs an email, how short a password may be, which SASL mechanisms
      // exist. A screen that guesses those offers a form the network refuses.
      this.send('irc:cap', {
        serverId,
        capabilities: caps,
        values: Object.fromEntries(
          Array.from(client.state.availableCapabilities).map(([name, value]) => [
            name,
            value ?? ''
          ])
        )
      })

      // A capability that turned up mid-session (CAP NEW) after we were already
      // registered still needs setting up.
      if (client.state.registrationState === 'connected') {
        this.publishProfile(client)
      }
    })

    client.events.on('isupport', (tokens) => {
      // The whole set, because what a member menu may offer is decided from
      // PREFIX and CHANMODES and the renderer had no way to see either.
      this.send('irc:isupport', { serverId, tokens })

      // Held to the same rule as a user's avatar, because it is the same
      // thing: a URL a server handed us that this client is about to fetch.
      // `^https?://` let a network point the client at plaintext http, which
      // tells anyone on the path which network you are on and when you
      // connected. The phone reads this token with the same helper.
      const iconUrl = avatarUrl(tokens['ICON'] || tokens['draft/ICON'])
      if (iconUrl) {
        this.send('irc:network-icon', { serverId, url: iconUrl })
      }
      const filehostUrl = tokens['FILEHOST'] || tokens['draft/FILEHOST']
      if (typeof filehostUrl === 'string' && /^https?:\/\//i.test(filehostUrl)) {
        this.send('irc:filehost', { serverId, url: filehostUrl })
      }
    })

    client.events.on('monitorOnline', (data) => {
      this.send('irc:monitor-online', { serverId, ...data })
    })

    client.events.on('monitorOffline', (data) => {
      this.send('irc:monitor-offline', { serverId, ...data })
    })

    // Server-side search results (draft/search)
    client.events.on('searchResults', (data: { messages: IRCMessage[] }) => {
      const chatMessages: ChatMessage[] = data.messages
        .filter((m) => m.command === 'PRIVMSG' || m.command === 'NOTICE')
        .map((m) => {
          const text = m.params[1] || ''
          const isAction = text.startsWith('\x01ACTION ') && text.endsWith('\x01')
          const content = isAction ? text.slice(8, -1) : text
          return {
            id: typeof m.tags['msgid'] === 'string' ? m.tags['msgid'] : uuid(),
            serverId,
            channel: m.params[0] || '',
            nick: m.source?.nick || '',
            userHost: m.source ? `${m.source.user || ''}@${m.source.host || ''}` : null,
            content,
            type: (isAction ? 'action' : m.command === 'NOTICE' ? 'notice' : 'privmsg') as 'action' | 'notice' | 'privmsg',
            tags: m.tags as Record<string, string>,
            replyTo: typeof m.tags['+reply'] === 'string' ? m.tags['+reply'] : null,
            timestamp: typeof m.tags['time'] === 'string' ? m.tags['time'] : new Date().toISOString(),
            account: typeof m.tags['account'] === 'string' ? m.tags['account'] : null,
            pending: false,
            reactions: {},
            channelContext: null
          }
        })
      this.send('irc:search-results', { serverId, messages: chatMessages })
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
