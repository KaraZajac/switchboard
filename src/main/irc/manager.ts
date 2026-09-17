import { hasMetadata } from '@shared/metadata'
import { canShareConnection } from '@shared/accounts'
import { isBouncer } from '@shared/bouncer'
import { filehostUrl } from '@shared/filehost'
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
import { markChannelJoined, markChannelParted } from '../storage/models/channel'
import { setReadMarker } from '../storage/models/readmarker'
import { subscribeToMetadata, metadataValueFits } from './features/metadata'
import { serversChanged } from '../ipc/notify'
import { resealVault } from '../vault/vault'
import { METADATA_KEYS, type UserMetadata } from '@shared/types/metadata'
import { v4 as uuid } from 'uuid'
import { friendListKind, friendListLines, friendListStatusLine } from '@shared/friends'
import { resolveProfile, keysToClear } from '@shared/profile'
import { secretsMasked } from '@shared/services'
import { eventLine } from '@shared/events'
import { isServiceNick } from '@shared/constants'
import { performLines } from '@shared/aliases'
import { logMessage } from '../storage/logfile'
import { noteDccOffer } from './features/dcc'
import { rememberRaw } from './rawlog'
import { runCommand } from './commands'
import { isIgnored, type IgnoreEntry, type IgnoreScope } from '@shared/ignore'
import { getSetting } from '../storage/models/settings'
import { logMessage as writeLogLine } from '../logging'

/** The vault key both clients keep the person's own profile under */
const DEFAULT_PROFILE = 'profile'

/** And the one they keep the ignore list under */
const IGNORE_LIST = 'ignores'

/** Whether to go back to a channel after being kicked out of it */
const REJOIN_ON_KICK = 'rejoinOnKick'
/** Whether joins, parts and quits are lines in the conversation — see `@shared/events` */
const SHOW_JOINS_PARTS = 'showJoinsParts'

/** How long to wait before doing so — shared, so the phone waits the same */
const REJOIN_DELAY_MS = REJOIN_AFTER_KICK_MS
import { avatarUrl } from '@shared/avatar'
import { REJOIN_AFTER_KICK_MS } from '@shared/constants'

/**
 * Manages all IRC client connections and bridges events to the renderer.
 */
export class IRCManager {
  private clients = new Map<string, IRCClient>()
  private autoConnected = false
  private eventSubscribers = new Set<(channel: string, data: unknown) => void>()
  /** Servers we disconnected because another device took over */
  private released: string[] = []

  /**
   * Connect to a server with the given config.
   */
  connect(config: ServerConfig): void {
    // Disconnect existing connection for this server
    if (this.clients.has(config.id)) {
      this.disconnect(config.id)
    }

    /*
     * Where to go is the config's list, and only that.
     *
     * It used to be the config's list *plus* whatever this machine was in the
     * last time it ran, kept in a local table. That predates `rememberJoin`
     * writing every join into the config, and once it did the local list
     * stopped being extra information and became a second opinion — one that
     * could only ever argue for rejoining.
     *
     * Which is how leaving a channel on the phone did not stick. The part took
     * it out of the shared config, the desktop started, read its own stale
     * table, walked back in — and `rememberJoin` then wrote it back into the
     * config and resealed the vault, so the phone's decision was undone
     * everywhere. Somebody leaving a channel had to leave it twice, and the
     * second time on the right device.
     */
    const client = new IRCClient(config)
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

    /**
     * Only what somebody here asked for — see `JoinReason` in `./client`.
     *
     * Asked first, before the "already listed" check below, because the
     * question has to be taken off the client either way: leave a `dial`
     * sitting there and the *next* join of the same channel reads as one.
     *
     * Two things were being written into the shared config that nobody chose:
     *
     *  - **Channels the server put us in.** `irc.d0ll.link` is UnrealIRCd with
     *    `set::auto-join`, so every connection that asks for nothing at all is
     *    joined to `#default` — confirmed against it with a bare socket. That
     *    join was read as a decision and written to the config, which then
     *    resealed the vault and reached the other device. Taking `#default`
     *    out of the auto-join list and saving worked, and the next connection
     *    put it straight back. Services rejoining an account where it usually
     *    is, an operator's `SAJOIN`, and a `+L` forward out of a full channel
     *    all arrive the same way.
     *  - **A dial landing after the config moved on.** The desktop connects
     *    with the list it has, which may be a week old; the link comes up, the
     *    phone's newer config is applied, and *then* the acks arrive — against
     *    a config that no longer lists them.
     */
    const why = this.clients.get(serverId)?.takeJoinReason(channel) ?? 'server'
    if (why !== 'user') return

    if (config.autoJoin.some((name) => foldCase(name) === foldCase(channel))) return

    updateServer(serverId, { autoJoin: [...config.autoJoin, channel] })
    serversChanged()
    // And into the shared config, or the phone never hears about a channel
    // joined here — it reads its channel list out of the vault, and the vault
    // was only ever resealed by the settings and server-editing handlers.
    resealVault()
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
    resealVault()
  }

  /**
   * Leave a channel, and mean it.
   *
   * Wanting out of a channel is two things at once: a `PART` on the wire, and
   * a decision about the list this device dials on every connection. Only the
   * first needs a socket, and only the second lasts.
   *
   * It used to be only the first. The auto-join list was pruned as a *side
   * effect* of the server echoing our own `PART` back, so leaving a channel
   * while the network was down did nothing at all — the handler threw `Not
   * connected`, the window took the channel out of its own list anyway, and
   * the next connection dialled straight back into it. A channel you left
   * while offline came back, which is the same complaint as every other
   * "it came back" in this file, arriving by a different door.
   *
   * The config first, because that is the part that has to happen. Idempotent:
   * the `part` event runs `forgetJoin` too, and it returns early once the
   * channel is no longer listed.
   */
  leave(serverId: string, channel: string): void {
    this.forgetJoin(serverId, channel)

    const client = this.clients.get(serverId)
    if (client?.connection.connected) client.part(channel)
  }

  /**
   * Disconnect from a server.
   */
  disconnect(serverId: string): void {
    // Any rejoin still waiting is about a connection that is going away
    for (const timer of this.rejoinTimers) clearTimeout(timer)
    this.rejoinTimers.clear()

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
  /** Every connection, for the things that act on all of them at once */
  connections(): Iterable<[string, IRCClient]> {
    return this.clients
  }

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

    /*
     * Not while another device is holding the network.
     *
     * The coordinator listens for a few seconds before deciding whether this
     * device should be the one connected, and that window is the whole reason
     * two devices do not turn up under one nick. This runs off a timer and
     * used to walk straight past it — so a desktop restarting beside an
     * always-on instance dialled everything, registered as `nick___`, and only
     * then heard the heartbeat and handed back. Everybody in the channel saw
     * it arrive and leave.
     *
     * Deliberately without setting `autoConnected`: this is "not yet", not
     * "done". Becoming primary calls `resumeConnections`, which is the right
     * door for it to come through.
     */
    if (!this.shouldHold()) return

    this.autoConnected = true

    for (const server of getAllServers()) {
      if (server.autoConnect) {
        this.connect(server)
      }
    }
  }

  /**
   * Whether this device is the one that should be on the network.
   *
   * Injected rather than imported: the remote link already imports this
   * manager, and asking it directly would close the circle. True by default,
   * because a Switchboard with no link is always the one holding.
   */
  private shouldHold: () => boolean = () => true

  useSessionRole(shouldHold: () => boolean): void {
    this.shouldHold = shouldHold
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
        .filter((server) => canShareConnection(server) || this.throughABouncer(server.id))
        .map((server) => server.id)
    )

    const releasing = [...this.clients.keys()].filter((serverId) => !shared.has(serverId))

    // Nothing to hand over. Deliberately without touching `released`: this is
    // asked more than once, and forgetting what we let go of would mean
    // dialling only the auto-connect list when we take the connections back.
    if (releasing.length === 0) return

    this.released = releasing
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
  /**
   * Whether this network is really a bouncer.
   *
   * Asked of the live connection rather than the saved config, because it is
   * not something you configure — it is something the far end says about
   * itself, and it can change under you when somebody moves a network behind
   * one. A bouncer takes both devices at once, so there is nothing to hand
   * over and dropping ours would take this device off a network it can
   * perfectly well stay on.
   */
  private throughABouncer(serverId: string): boolean {
    const state = this.clients.get(serverId)?.state
    // A connection that has not been told anything yet is not known to be one,
    // and treating it as one would let both devices on a server that will not
    // have them
    if (!state) return false
    // What the server offered, not what we asked for: whether this is a
    // bouncer is a fact about the far end, and a client that happened not to
    // request a capability has not changed what it is talking to
    return isBouncer(state.isupport, state.availableCapabilities.keys())
  }

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
   * Whatever this network was told to run on connect.
   *
   * A leading slash means a command and anything else is raw IRC, which is
   * what every other client's "perform" does. After the profile and the friend
   * list rather than before, so a `/join` here lands with everything else
   * already in place.
   *
   * Not redacted out of the raw log by accident: `redactLine` already blanks a
   * NickServ password wherever it appears, and this is the most likely place
   * for one to be.
   */
  private runPerform(client: IRCClient, serverId: string): void {
    const config = getServer(serverId)
    const lines = performLines(config?.performOnConnect)
    if (lines.length === 0) return

    for (const line of lines) {
      if (line.startsWith('/')) {
        // Through the ordinary command path, so `/msg` means what it means
        // everywhere else — including keeping a password out of a channel.
        const result = runCommand(client, '*', line)
        if (result.error) {
          client.events.emit('error', {
            code: 'PERFORM',
            command: line.split(' ')[0],
            message: result.error
          })
        }
        continue
      }
      client.connection.sendRaw(line)
    }
  }

  /**
   * Go back to a channel we were kicked out of.
   *
   * Off unless somebody turns it on, and it should be: rejoining the instant
   * an operator removes you is rude, and on some networks it is what turns a
   * kick into a ban. The delay is not politeness theatre either — an immediate
   * JOIN races the `+b` that usually follows and gets refused, so the client
   * would announce a failure it caused itself.
   */
  private rejoinAfterKick(client: IRCClient, channel: string): void {
    if (!getSetting<boolean>(REJOIN_ON_KICK)) return

    const wait = setTimeout(() => {
      this.rejoinTimers.delete(wait)
      // Still connected, and not already back by hand
      if (client.state.registrationState !== 'connected') return
      if (client.state.channels.has(client.state.casemap(channel))) return
      // Going back where we were, not deciding to go somewhere new
      client.noteJoinRequest(channel, 'dial')
      client.connection.send('JOIN', channel)
    }, REJOIN_DELAY_MS)

    this.rejoinTimers.add(wait)
  }

  /** Pending rejoins, so disconnecting does not leave one to fire into nothing */
  private rejoinTimers = new Set<ReturnType<typeof setTimeout>>()

  /**
   * Whether this is somebody we have decided not to hear from.
   *
   * Read fresh rather than cached: the list is small, it is edited from either
   * device, and a cache would mean ignoring somebody on the phone and still
   * hearing them at the desk until a restart.
   *
   * A `userHost` we do not have is not a reason to let something through — the
   * mask matching treats an unknown user or host as a wildcard would, so a
   * `nick!*@*` ignore still works on a network that tells us nothing else.
   */
  private ignored(
    serverId: string,
    nick: string,
    userHost: string | null | undefined,
    kind: keyof IgnoreScope = 'messages'
  ): boolean {
    const list = getSetting<IgnoreEntry[]>(IGNORE_LIST)
    if (!list || list.length === 0) return false

    const at = (userHost || '').indexOf('@')
    const who = {
      nick,
      user: at === -1 ? null : (userHost as string).slice(0, at),
      host: at === -1 ? userHost || null : (userHost as string).slice(at + 1)
    }
    return isIgnored(list, serverId, who, kind)
  }

  /**
   * Tell both windows about a metadata change we made ourselves.
   *
   * The same event a server echo produces, so nothing downstream needs to know
   * which of the two it was.
   */
  /**
   * What a line of ours to services is kept as: its password gone.
   *
   * Applied where a message becomes a stored one, live or replayed, so the
   * secret never reaches the database or the window. See `secretsMasked`.
   */
  private kept(client: IRCClient, channel: string, nick: string, content: string): string {
    if (!isServiceNick(channel)) return content
    if (client.state.casemap(nick) !== client.state.casemap(client.state.nick)) return content
    return secretsMasked(channel, content)
  }

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
    // Every line that reaches the window is a line for the log — see `logging.ts`
    if (channel === 'irc:message') {
      const {
        serverId,
        channel: target,
        message
      } = data as {
        serverId: string
        channel: string
        message: ChatMessage
      }
      writeLogLine(serverId, target, message)
    }
    /*
     * One way out, not two.
     *
     * The window used to be held here and written to directly, alongside a
     * list of subscribers that got the same events — so the engine knew what a
     * BrowserWindow was, and the desktop window and a paired device were fed
     * by different code. The window is just the first subscriber now, which is
     * also what lets this run with no window at all.
     */
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

  /**
   * Networks whose friend list has been sent on this connection.
   *
   * ISUPPORT can arrive over several lines and the list must go exactly once
   * per connection — it is dropped when a connection is made, not when one
   * ends, because that is the moment there is nothing on the far side again.
   */
  private readonly friendListArmed = new Set<string>()

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

      // The friend list is re-sent when ISUPPORT says which command to use,
      // which is after this — see the `isupport` listener below
      this.friendListArmed.delete(serverId)

      this.runPerform(client, serverId)
    })

    client.events.on('disconnected', (reason) => {
      this.send('irc:disconnected', { serverId, reason })
    })

    client.events.on('reconnecting', (delayMs) => {
      this.send('irc:reconnecting', { serverId, delayMs })
    })

    client.events.on('certificate', (problem) => {
      this.send('irc:certificate', { serverId, ...problem })
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
        this.rejoinAfterKick(client, data.channel)
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

    // `/dcc send` typed in the composer. The picker belongs to the window, so
    // this is a request rather than an action.
    client.events.on('dccOfferWanted', (data) => {
      this.send('dcc:offer-wanted', { serverId, nick: data.nick })
    })

    // Somebody offering a file. Recorded and shown; nothing connects until a
    // person says so — auto-accepting a DCC is how the protocol got its
    // reputation.
    client.events.on('dcc', (data) => {
      if (this.ignored(serverId, data.nick, null, 'requests')) return
      const transfer = noteDccOffer(serverId, data.nick, data.body)
      if (!transfer) return

      // Say so in the conversation it belongs to. An offer from somebody you
      // have never messaged otherwise has nowhere to appear — and a line
      // saying what was offered is worth having afterwards either way.
      const said: ChatMessage = {
        id: uuid(),
        serverId,
        channel: data.nick,
        nick: '',
        userHost: null,
        content: `${data.nick} is offering you ${transfer.filename}`,
        type: 'system',
        tags: {},
        replyTo: null,
        timestamp: new Date().toISOString(),
        account: null,
        pending: false,
        reactions: {},
        channelContext: null
      }
      storeMessage(said)
      this.send('irc:message', { serverId, channel: data.nick, message: said })
    })

    // Invite notifications
    client.events.on('invite', (data) => {
      // An invitation from somebody you ignore is the most obvious way around
      // an ignore, which is why `requests` is on by default.
      if (this.ignored(serverId, data.by, null, 'requests')) return
      if (data.isMe) {
        this.send('irc:invite', { serverId, channel: data.channel, by: data.by })
      }
    })

    // Message events
    client.events.on('privmsg', (data) => {
      // Somebody on the ignore list said nothing, as far as this client is
      // concerned. Dropped here rather than hidden in the UI: an ignored
      // message that is stored still comes back on the next reload, still
      // counts towards an unread badge, and still wakes the phone up.
      if (this.ignored(serverId, data.nick, data.userHost)) return

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
        content: this.kept(client, data.channel, data.nick, data.content),
        type: data.type,
        tags: data.tags as Record<string, string>,
        replyTo: data.replyTo || null,
        timestamp: data.time,
        account: data.account || null,
        oper: (data.oper as string | null) ?? null,
        relayedBy: (data.relayedBy as string | null) ?? null,
        pending: false,
        reactions: {},
        channelContext:
          typeof data.tags['+draft/channel-context'] === 'string'
            ? data.tags['+draft/channel-context']
            : null
      }

      // Store in database
      storeMessage(message)
      logMessage(getServer(serverId)?.name || serverId, message)

      this.send('irc:message', { serverId, channel: data.channel, message })
    })

    client.events.on('notice', (data) => {
      if (this.ignored(serverId, data.nick, null)) return

      const message: ChatMessage = {
        id: data.msgid || uuid(),
        serverId,
        channel: data.channel,
        nick: data.nick,
        userHost: null,
        content: data.content,
        type: data.type,
        tags: data.tags as Record<string, string>,
        replyTo: null,
        timestamp: data.time,
        account: null,
        pending: false,
        reactions: {},
        channelContext: null
      }

      storeMessage(message)
      logMessage(getServer(serverId)?.name || serverId, message)
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
      (data: { channel: string; nick: string; emoji: string; msgid: string; removed: boolean }) => {
        // Parsed and then dropped before this: the reaction reached the client
        // and stopped there, so nothing ever showed one — on either client.
        //
        // Kept, too. A reaction that vanishes on the next restart is not really
        // on the message; it was on the screen.
        setReaction(serverId, data.channel, data.msgid, data.emoji, data.nick, data.removed)
        this.send('irc:react', { serverId, ...data })
      }
    )

    client.events.on(
      'redact',
      (data: { channel: string; msgid: string; nick: string; reason: string | null }) => {
        // Delete from local database
        deleteMessage(data.msgid)
        this.send('irc:redact', { serverId, channel: data.channel, msgid: data.msgid })
      }
    )

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
    client.events.on(
      'channelRename',
      (data: { oldName: string; newName: string; reason: string | null }) => {
        this.send('irc:channel-rename', { serverId, ...data })
      }
    )

    // Chathistory batch (including draft/event-playback events)
    client.events.on('chathistoryBatch', (data: { target: string; messages: IRCMessage[] }) => {
      // The noisy three only where they are wanted, the same as live — a
      // reconnect used to replay every join and quit into a conversation
      // that showed none of them as they happened.
      const showJoins = getSetting<boolean>(SHOW_JOINS_PARTS) === true
      const chatMessages: ChatMessage[] = data.messages
        .filter(
          (m) =>
            m.command === 'PRIVMSG' ||
            m.command === 'NOTICE' ||
            ((m.command === 'JOIN' || m.command === 'PART' || m.command === 'QUIT') && showJoins) ||
            m.command === 'NICK' ||
            m.command === 'TOPIC' ||
            m.command === 'KICK'
        )
        .map((m) => {
          const timestamp =
            typeof m.tags['time'] === 'string' ? m.tags['time'] : new Date().toISOString()
          const nick = m.source?.nick || ''

          // Event-playback: convert channel events to system messages
          if (m.command === 'JOIN') {
            return {
              id: typeof m.tags['msgid'] === 'string' ? m.tags['msgid'] : uuid(),
              serverId,
              channel: data.target,
              nick: '',
              userHost: null,
              content: eventLine({ kind: 'join', nick }),
              type: 'system' as const,
              tags: {},
              replyTo: null,
              timestamp,
              account: null,
              pending: false,
              reactions: {},
              channelContext: null
            }
          }
          if (m.command === 'PART') {
            const reason = m.params[1] || null
            return {
              id: typeof m.tags['msgid'] === 'string' ? m.tags['msgid'] : uuid(),
              serverId,
              channel: data.target,
              nick: '',
              userHost: null,
              content: eventLine({ kind: 'part', nick, reason }),
              type: 'system' as const,
              tags: {},
              replyTo: null,
              timestamp,
              account: null,
              pending: false,
              reactions: {},
              channelContext: null
            }
          }
          if (m.command === 'QUIT') {
            const reason = m.params[0] || null
            return {
              id: typeof m.tags['msgid'] === 'string' ? m.tags['msgid'] : uuid(),
              serverId,
              channel: data.target,
              nick: '',
              userHost: null,
              content: eventLine({ kind: 'quit', nick, reason }),
              type: 'system' as const,
              tags: {},
              replyTo: null,
              timestamp,
              account: null,
              pending: false,
              reactions: {},
              channelContext: null
            }
          }
          if (m.command === 'NICK') {
            return {
              id: typeof m.tags['msgid'] === 'string' ? m.tags['msgid'] : uuid(),
              serverId,
              channel: data.target,
              nick: '',
              userHost: null,
              content: eventLine({ kind: 'nick', nick, detail: m.params[0] }),
              type: 'system' as const,
              tags: {},
              replyTo: null,
              timestamp,
              account: null,
              pending: false,
              reactions: {},
              channelContext: null
            }
          }
          if (m.command === 'TOPIC') {
            return {
              id: typeof m.tags['msgid'] === 'string' ? m.tags['msgid'] : uuid(),
              serverId,
              channel: data.target,
              nick: '',
              userHost: null,
              content: eventLine({ kind: 'topic', nick, detail: m.params[1] || '' }),
              type: 'system' as const,
              tags: {},
              replyTo: null,
              timestamp,
              account: null,
              pending: false,
              reactions: {},
              channelContext: null
            }
          }
          if (m.command === 'KICK') {
            const reason = m.params[2] || null
            return {
              id: typeof m.tags['msgid'] === 'string' ? m.tags['msgid'] : uuid(),
              serverId,
              channel: data.target,
              nick: '',
              userHost: null,
              content: eventLine({ kind: 'kick', nick: m.params[1] || '', detail: nick, reason }),
              type: 'system' as const,
              tags: {},
              replyTo: null,
              timestamp,
              account: null,
              pending: false,
              reactions: {},
              channelContext: null
            }
          }

          // Regular PRIVMSG/NOTICE
          const text = m.params[1] || ''
          const isAction = text.startsWith('\x01ACTION ') && text.endsWith('\x01')
          const content = isAction ? text.slice(8, -1) : text

          const msg: ChatMessage = {
            id: typeof m.tags['msgid'] === 'string' ? m.tags['msgid'] : uuid(),
            serverId,
            channel: data.target,
            nick,
            userHost: m.source ? `${m.source.user || ''}@${m.source.host || ''}` : null,
            content: this.kept(client, data.target, nick, content),
            type: isAction ? 'action' : m.command === 'NOTICE' ? 'notice' : 'privmsg',
            tags: m.tags as Record<string, string>,
            replyTo: typeof m.tags['+reply'] === 'string' ? m.tags['+reply'] : null,
            timestamp,
            account: typeof m.tags['account'] === 'string' ? m.tags['account'] : null,
            pending: false,
            reactions: {},
            channelContext:
              typeof m.tags['+draft/channel-context'] === 'string'
                ? m.tags['+draft/channel-context']
                : null
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
    client.events.on(
      'netsplit',
      (data: { server1: string; server2: string; quits: { nick: string }[] }) => {
        this.send('irc:netsplit', {
          serverId,
          server1: data.server1,
          server2: data.server2,
          nicks: data.quits.map((q) => q.nick)
        })
      }
    )

    client.events.on(
      'netjoin',
      (data: { server1: string; server2: string; joins: { nick: string }[] }) => {
        this.send('irc:netjoin', {
          serverId,
          server1: data.server1,
          server2: data.server2,
          nicks: data.joins.map((j) => j.nick)
        })
      }
    )

    // Server info events
    client.events.on('motd', (lines) => {
      this.send('irc:motd', { serverId, lines })
    })

    client.events.on('readMarker', (data: { channel: string; timestamp: string }) => {
      // Write it down. The position belongs to the network rather than to this
      // device, and a marker that only ever lived in the window was forgotten
      // at every restart: the next start loaded whatever *this* machine had
      // last set, which is older by definition, and then offered it back to
      // the server as where the conversation had been read to.
      //
      // Forward only, so a marker arriving after this device has read past it
      // changes nothing — see `@shared/readmarker`.
      setReadMarker(serverId, data.channel, data.timestamp)

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
          Array.from(client.state.availableCapabilities).map(([name, value]) => [name, value ?? ''])
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

      /*
       * The friend list, re-sent now rather than on 001.
       *
       * It lives on the connection and dies with it, so every connect has to
       * say it again — and which command to say it in is in ISUPPORT, which
       * arrives in 005, *after* the 001 this used to be done on. So the list
       * was asked about (`MONITOR S`) and never actually sent: the server was
       * asked the status of a list it had nothing on, and every friend sat
       * there reading offline for ever.
       *
       * Once per connection: a server may send several 005 lines, and sending
       * the list once per line is a flood on a long friend list.
       */
      if (!this.friendListArmed.has(serverId)) {
        const kind = friendListKind(client.state.isupport)
        const nicks = kind ? getMonitorList(serverId) : []
        if (kind && nicks.length > 0) {
          this.friendListArmed.add(serverId)
          for (const line of friendListLines(kind, nicks, 'add')) {
            client.connection.sendRaw(line)
          }
          client.connection.sendRaw(friendListStatusLine(kind))
        }
      }

      // Held to the same rule as a user's avatar, because it is the same
      // thing: a URL a server handed us that this client is about to fetch.
      // `^https?://` let a network point the client at plaintext http, which
      // tells anyone on the path which network you are on and when you
      // connected. The phone reads this token with the same helper.
      const iconUrl = avatarUrl(tokens['ICON'] || tokens['draft/ICON'])
      if (iconUrl) {
        this.send('irc:network-icon', { serverId, url: iconUrl })
      }
      /*
       * Through the shared rule, not a regex of its own.
       *
       * This is what puts the attach button in front of somebody, so it has to
       * agree with what the upload will actually do — including refusing a
       * plaintext filehost on an encrypted connection. Offering the button and
       * then refusing the file is worse than not offering it.
       */
      const filehost = filehostUrl(tokens, { overTls: client.connection.encrypted })
      if (filehost) {
        this.send('irc:filehost', { serverId, url: filehost })
      }
    })

    /*
     * What this bouncer says it holds.
     *
     * Only worth telling the window when there is something to act on: an
     * ordinary server never sends these, and a bouncer this network is already
     * bound to is describing networks the user has presumably already dealt
     * with.
     */
    client.events.on('bouncerNetworks', (data) => {
      this.send('irc:bouncer-networks', {
        serverId,
        boundTo: client.config.bouncerNetId ?? null,
        networks: data.networks
      })
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
            content: this.kept(client, m.params[0] || '', m.source?.nick || '', content),
            type: (isAction ? 'action' : m.command === 'NOTICE' ? 'notice' : 'privmsg') as
              | 'action'
              | 'notice'
              | 'privmsg',
            tags: m.tags as Record<string, string>,
            replyTo: typeof m.tags['+reply'] === 'string' ? m.tags['+reply'] : null,
            timestamp:
              typeof m.tags['time'] === 'string' ? m.tags['time'] : new Date().toISOString(),
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
      // And kept, so the server log opens on the connection that has already
      // gone wrong rather than on whatever happens next. Credentials are
      // masked as it is kept — see `rawlog`.
      this.send('irc:raw-line', { serverId, entry: rememberRaw(serverId, direction, line) })
    })
  }
}

/** Singleton manager instance */
export const ircManager = new IRCManager()
