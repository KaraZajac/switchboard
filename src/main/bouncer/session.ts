import type { Socket } from 'net'
import { timingSafeEqual } from 'crypto'
import { parseMessage } from '../irc/parser'
import { serializeMessage, cmd } from '../irc/serializer'
import type { IRCMessage } from '@shared/types/irc'
import type { IRCClient } from '../irc/client'
import { parseLogin, type BouncerLogin } from '@shared/bouncerlogin'
import { formatAttributes, parseAttributes } from '@shared/bouncer'

/**
 * One IRC client attached to this bouncer.
 *
 * The thing that makes Switchboard headless worth running: irssi, WeeChat,
 * Halloy, Textual or another Switchboard dials in over plain IRC and gets the
 * network it asked for — already connected, already in your channels, under
 * your nick. Nothing on the far side needs to know it is talking to a bouncer.
 *
 * This is deliberately not the remote link. That is Switchboard's own
 * protocol, and it carries far more than IRC does: settings, the vault, read
 * markers, the session hand-over. This carries IRC, because that is what
 * everything else in the world speaks.
 */

export type NetworkLookup = {
  /** Every network this bouncer holds */
  all: () => { id: string; name: string; client: IRCClient | undefined }[]
  find: (wanted: string) => { id: string; name: string; client: IRCClient | undefined } | null
}

export interface SessionOptions {
  /** What the bouncer calls itself in the prefix of its own messages */
  serverName: string
  /** Null when no password is set, in which case any login is accepted */
  password: string | null
  networks: NetworkLookup
  version: string
  /** Backlog for a client that has just attached, newest last */
  backlog?: (serverId: string, target: string, limit: number) => RelayableMessage[]
  /**
   * Hand a line this client just said to every other client on the same
   * network. The server owns the list of sessions, so it does the sending.
   */
  onEcho?: (from: BouncerSession, upstream: IRCClient, line: string) => void
  /**
   * Adding, changing and removing networks from an attached client.
   *
   * Absent means this bouncer will not be reconfigured over IRC, and every
   * such command is refused with a reason rather than ignored.
   */
  manage?: {
    add: (attributes: Map<string, string | null>) => { id: string | null; error: string | null }
    change: (id: string, attributes: Map<string, string | null>) => { error: string | null }
    remove: (id: string) => { error: string | null }
  }
}

export interface RelayableMessage {
  time: string
  nick: string
  text: string
  /** PRIVMSG unless the stored message says otherwise */
  kind?: 'privmsg' | 'notice'
}

/**
 * Capabilities this bouncer can honour on its own.
 *
 * Kept separate from whatever the upstream negotiated, because these are
 * promises *we* keep: `server-time` because every relayed line gets a time
 * whether or not the network sent one, `echo-message` because a second
 * attached client has to see what the first one said, `sasl` because it is how
 * modern clients expect to log in.
 *
 * Capabilities that change what the *network* sends — `away-notify`,
 * `extended-join` and the rest — are added from the upstream instead. Offering
 * one the network never agreed to would mean promising messages that will
 * never arrive.
 */
const OWN_CAPS: Record<string, string | null> = {
  'server-time': null,
  'message-tags': null,
  batch: null,
  'echo-message': null,
  sasl: 'PLAIN',
  'soju.im/bouncer-networks': null,
  'soju.im/bouncer-networks-notify': null
}

/**
 * Capabilities worth passing on from the network.
 *
 * An allowlist rather than everything the upstream has, because some of what a
 * network negotiates is about *our* connection to it and means nothing
 * downstream — `sasl` most of all, where offering it would invite a client to
 * authenticate to a network it is not connected to.
 */
const RELAYED_CAPS = new Set([
  'account-notify',
  'account-tag',
  'away-notify',
  'chghost',
  'extended-join',
  'invite-notify',
  'multi-prefix',
  'setname',
  'userhost-in-names',
  'message-tags',
  'batch',
  'labeled-response',
  'draft/chathistory',
  'draft/read-marker',
  'draft/multiline'
])

/**
 * What never reaches an attached client.
 *
 * Registration is ours to conduct: the client registered with *us*, so it must
 * see one welcome, from us, describing the network it bound to — not a second
 * one every time the upstream reconnects. Keepalives are answered by whichever
 * end was pinged. `ERROR` would tell a client the connection is over when it is
 * only the upstream's, and the whole point of a bouncer is that the client's
 * connection outlives it.
 */
const NOT_RELAYED = new Set([
  'CAP',
  'AUTHENTICATE',
  'PING',
  'PONG',
  'ERROR',
  '001',
  '002',
  '003',
  '004',
  '005',
  '251',
  '252',
  '253',
  '254',
  '255',
  '265',
  '266',
  '375',
  '372',
  '376',
  '422',
  '900',
  '901',
  '902',
  '903',
  '904',
  '905',
  '906',
  '907',
  '908'
])

/**
 * Commands an attached client sends that stop here.
 *
 * `QUIT` above all. A client closing is a client closing — passing it upstream
 * would take the network down with it, which is the one thing a bouncer exists
 * to prevent.
 */
const HANDLED_LOCALLY = new Set(['CAP', 'PASS', 'USER', 'AUTHENTICATE', 'PING', 'QUIT', 'BOUNCER'])

let nextId = 1

export class BouncerSession {
  readonly id = nextId++

  private buffer = ''
  private registered = false
  private closed = false

  /** Capabilities this client asked for and got */
  private readonly caps = new Set<string>()
  private capNegotiating = false

  private password: string | null = null
  private login: BouncerLogin = { user: '', client: null, network: null }
  private wantedNick = '*'
  private authenticated = false
  private saslBuffer = ''

  /** The network this client is bound to, once it has one */
  private bound: { id: string; name: string; client: IRCClient | undefined } | null = null
  private detachRelay: (() => void) | null = null

  constructor(
    private readonly socket: Socket,
    private readonly options: SessionOptions,
    private readonly onClose: (session: BouncerSession) => void
  ) {
    socket.setEncoding('utf8')
    socket.setNoDelay(true)
    socket.on('data', (chunk: string) => this.take(chunk))
    socket.on('error', () => this.close())
    socket.on('close', () => this.close())

    // A client that connects and says nothing holds a socket open forever.
    socket.setTimeout(120_000, () => {
      if (!this.registered) this.close()
    })
  }

  /** The network id this client is bound to, for the server's own bookkeeping */
  get boundTo(): string | null {
    return this.bound?.id ?? null
  }

  get clientName(): string {
    return this.login.client ?? this.login.user ?? 'client'
  }

  get wants(): ReadonlySet<string> {
    return this.caps
  }

  // ── Reading ────────────────────────────────────────────────────

  private take(chunk: string): void {
    this.buffer += chunk

    // A client that never sends a newline must not be able to grow this
    // without limit.
    if (this.buffer.length > 64 * 1024) {
      this.fail('Line too long')
      return
    }

    const lines = this.buffer.split(/\r?\n/)
    this.buffer = lines.pop() ?? ''

    for (const line of lines) {
      if (!line.trim()) continue
      try {
        this.handle(parseMessage(line))
      } catch {
        // A line we cannot parse is the client's problem, not a reason to drop
        // a connection that is otherwise working.
      }
    }
  }

  private handle(msg: IRCMessage): void {
    const command = msg.command.toUpperCase()

    switch (command) {
      case 'PASS':
        this.password = msg.params[0] ?? null
        return
      case 'NICK':
        if (!this.registered) {
          this.wantedNick = msg.params[0] ?? '*'
          this.finishRegistration()
          return
        }
        break
      case 'USER':
        this.login = parseLogin(msg.params[0] ?? '')
        this.finishRegistration()
        return
      case 'CAP':
        this.negotiate(msg)
        return
      case 'AUTHENTICATE':
        this.authenticate(msg.params[0] ?? '')
        return
      case 'PING':
        this.fromServer('PONG', this.options.serverName, ...(msg.params[0] ? [msg.params[0]] : []))
        return
      case 'QUIT':
        this.write(cmd('ERROR', 'Closing connection'))
        this.close()
        return
      case 'BOUNCER':
        this.bouncerCommand(msg)
        return
    }

    if (!this.registered) return
    if (HANDLED_LOCALLY.has(command)) return

    const upstream = this.bound?.client
    if (!upstream) {
      this.numeric('451', 'You are not bound to a network')
      return
    }

    /*
     * Echo to the others, but only when the network will not.
     *
     * Another attached client has to see what this one said, and most networks
     * do not send our own PRIVMSG back. Where one does — `echo-message`
     * negotiated upstream — its copy is the better one: it carries the real
     * `msgid`, which is what a reply, a reaction and a redaction are addressed
     * to, and it arrives with the network's own timestamp.
     *
     * Doing both sent the sender its own line twice, one of the two without an
     * id.
     */
    const sayable = command === 'PRIVMSG' || command === 'NOTICE' || command === 'TAGMSG'
    if (sayable && !upstream.state.capabilities.has('echo-message')) {
      this.echo(msg, upstream)
    }

    upstream.connection.sendRaw(serializeMessage(msg))
  }

  // ── Registration ───────────────────────────────────────────────

  private negotiate(msg: IRCMessage): void {
    const sub = (msg.params[0] ?? '').toUpperCase()

    switch (sub) {
      case 'LS': {
        this.capNegotiating = !this.registered
        const offered = Object.entries(this.available())
          .map(([name, value]) => (value === null ? name : `${name}=${value}`))
          .join(' ')
        this.fromServer('CAP', this.wantedNick, 'LS', offered)
        return
      }
      case 'LIST':
        this.fromServer('CAP', this.wantedNick, 'LIST', [...this.caps].join(' '))
        return
      case 'REQ': {
        const wanted = (msg.params[1] ?? '').split(' ').filter(Boolean)
        const available = this.available()
        const ok = wanted.every((name) => name.replace(/^-/, '') in available)
        if (ok) {
          for (const name of wanted) {
            if (name.startsWith('-')) this.caps.delete(name.slice(1))
            else this.caps.add(name)
          }
        }
        this.fromServer('CAP', this.wantedNick, ok ? 'ACK' : 'NAK', wanted.join(' '))
        return
      }
      case 'END':
        this.capNegotiating = false
        this.finishRegistration()
        return
    }
  }

  /** Ours, plus whatever the network agreed to that means something here */
  private available(): Record<string, string | null> {
    const offered: Record<string, string | null> = { ...OWN_CAPS }
    const upstream = this.bound?.client ?? this.options.networks.all()[0]?.client
    for (const name of upstream?.state.capabilities ?? []) {
      if (RELAYED_CAPS.has(name)) offered[name] = null
    }
    return offered
  }

  /**
   * SASL PLAIN, which is how a modern client expects to log in.
   *
   * Only PLAIN: the exchange is with this bouncer over a connection somebody
   * chose to make, not with a network across the internet, and the alternatives
   * exist to avoid sending a password to a *stranger*. Offering SCRAM here
   * would be ceremony without a threat it answers.
   */
  private authenticate(payload: string): void {
    if (payload === '*') {
      this.fromServer('904', this.wantedNick, 'SASL authentication aborted')
      this.saslBuffer = ''
      return
    }

    if (payload === 'PLAIN') {
      this.write(cmd('AUTHENTICATE', '+'))
      return
    }

    // 400-byte chunks, continued by a line of exactly 400
    this.saslBuffer += payload
    if (payload.length === 400) return

    const decoded = Buffer.from(this.saslBuffer.replace(/\+$/, ''), 'base64').toString('utf8')
    this.saslBuffer = ''

    const [, user, password] = decoded.split('\0')
    this.login = parseLogin(user ?? '')
    this.password = password ?? null

    if (!this.passwordAccepted()) {
      this.fromServer('904', this.wantedNick, 'Bad password')
      return
    }

    this.authenticated = true
    this.fromServer(
      '900',
      this.wantedNick,
      `${this.wantedNick}!${this.login.user}@bouncer`,
      this.login.user,
      'You are now logged in'
    )
    this.fromServer('903', this.wantedNick, 'SASL authentication successful')
  }

  private passwordAccepted(): boolean {
    const expected = this.options.password
    if (!expected) return true
    if (!this.password) return false

    // Same length or not, the comparison takes the same time
    const a = Buffer.from(this.password)
    const b = Buffer.from(expected)
    if (a.length !== b.length) {
      timingSafeEqual(b, b)
      return false
    }
    return timingSafeEqual(a, b)
  }

  private finishRegistration(): void {
    if (this.registered || this.capNegotiating) return
    if (this.wantedNick === '*' || !this.login.user) return

    if (!this.authenticated && !this.passwordAccepted()) {
      this.numeric('464', 'Password incorrect')
      this.write(cmd('ERROR', 'Closing connection'))
      this.close()
      return
    }

    this.registered = true

    /*
     * A client that named a network is bound before it sees the welcome.
     *
     * That matters: the welcome carries the network's own ISUPPORT, its nick
     * and its name, and a client reads those once. Binding afterwards would
     * leave it believing it was on a server called `switchboard` with default
     * limits, and every line it composed after that would be sized wrong.
     */
    if (this.login.network) {
      const found = this.options.networks.find(this.login.network)
      if (!found) {
        this.numeric('402', `${this.login.network} :No such network`)
        this.welcomeToBouncer()
        return
      }
      this.bind(found)
      return
    }

    // Exactly one network and no `soju.im/bouncer-networks` is somebody's
    // plain IRC client with nowhere to say which network it meant. There is
    // only one answer, so give it rather than making them edit a config.
    const all = this.options.networks.all()
    if (all.length === 1 && !this.caps.has('soju.im/bouncer-networks') && all[0]) {
      this.bind(all[0])
      return
    }

    this.welcomeToBouncer()
  }

  // ── Binding to a network ───────────────────────────────────────

  private bouncerCommand(msg: IRCMessage): void {
    const sub = (msg.params[0] ?? '').toUpperCase()

    if (sub === 'BIND') {
      const wanted = msg.params[1] ?? ''
      const found = this.options.networks.find(wanted)
      if (!found) {
        this.fromServer('FAIL', 'BOUNCER', 'INVALID_NETID', wanted, 'No such network')
        return
      }
      this.bind(found)
      return
    }

    if (sub === 'ADDNETWORK') {
      const { id, error } = this.options.manage?.add(parseAttributes(msg.params[1] ?? '')) ?? {
        id: null,
        error: 'This bouncer does not take new networks from a client'
      }
      if (error || !id) {
        this.fromServer('FAIL', 'BOUNCER', 'UNKNOWN_ERROR', 'ADDNETWORK', error ?? 'Failed')
        return
      }
      this.fromServer('BOUNCER', 'ADDNETWORK', id)
      return
    }

    if (sub === 'CHANGENETWORK') {
      const id = msg.params[1] ?? ''
      const error =
        this.options.manage?.change(id, parseAttributes(msg.params[2] ?? '')).error ??
        'This bouncer does not take changes from a client'
      if (error) {
        this.fromServer('FAIL', 'BOUNCER', 'UNKNOWN_ERROR', 'CHANGENETWORK', error)
        return
      }
      this.fromServer('BOUNCER', 'CHANGENETWORK', id)
      return
    }

    if (sub === 'DELNETWORK') {
      const id = msg.params[1] ?? ''
      const error =
        this.options.manage?.remove(id).error ?? 'This bouncer does not take removals from a client'
      if (error) {
        this.fromServer('FAIL', 'BOUNCER', 'INVALID_NETID', id, error)
        return
      }
      this.fromServer('BOUNCER', 'DELNETWORK', id)
      return
    }

    if (sub === 'LISTNETWORKS') {
      for (const network of this.options.networks.all()) {
        this.fromServer('BOUNCER', 'NETWORK', network.id, this.describe(network))
      }
      this.fromServer('BOUNCER', 'LISTNETWORKS', 'RPL_LISTEND')
      return
    }

    this.fromServer('FAIL', 'BOUNCER', 'UNKNOWN_COMMAND', sub, 'Unknown subcommand')
  }

  describe(network: { id: string; name: string; client: IRCClient | undefined }): string {
    const upstream = network.client
    const connected = upstream?.state.registrationState === 'connected'
    return formatAttributes({
      name: network.name,
      state: connected ? 'connected' : 'disconnected',
      nickname: upstream?.state.nick ?? '',
      host: upstream?.config.host ?? ''
    })
  }

  /** Attach to a network, and tell the client everything it has missed */
  bind(network: { id: string; name: string; client: IRCClient | undefined }): void {
    this.detachRelay?.()
    this.bound = network

    const upstream = network.client
    const nick = upstream?.state.nick || this.wantedNick
    this.wantedNick = nick

    this.welcome(network.name, nick, upstream)
    this.replayChannels(upstream)

    if (upstream) this.detachRelay = this.relayFrom(upstream)
  }

  private welcomeToBouncer(): void {
    this.welcome('Switchboard', this.wantedNick, undefined)

    const networks = this.options.networks.all()
    this.fromServer(
      'NOTICE',
      this.wantedNick,
      networks.length === 0
        ? 'No networks configured. Add one from Switchboard on your desktop or phone.'
        : `Bound to no network. Log in as user/<network>, or use BOUNCER BIND. Known: ${networks
            .map((n) => n.name)
            .join(', ')}`
    )

    if (this.caps.has('soju.im/bouncer-networks-notify')) {
      for (const network of networks) {
        this.fromServer('BOUNCER', 'NETWORK', network.id, this.describe(network))
      }
    }
  }

  private welcome(networkName: string, nick: string, upstream: IRCClient | undefined): void {
    const me = this.options.serverName
    this.fromServer('001', nick, `Welcome to ${networkName} via Switchboard, ${nick}`)
    this.fromServer('002', nick, `Your host is ${me}, running Switchboard ${this.options.version}`)
    this.fromServer('003', nick, 'This bouncer holds your connection while you are away')
    this.fromServer('004', nick, me, `switchboard-${this.options.version}`, 'io', 'beIiklmnopstv')

    /*
     * The network's own limits, not ours.
     *
     * A client sizes every message it sends against these — nick length,
     * channel length, the maximum line — and sends it on to a network that has
     * its own answer. Passing the upstream's through means a client attached
     * here behaves exactly as it would connected directly.
     */
    const isupport = Object.entries(upstream?.state.isupport ?? {})
      .map(([key, value]) => (value === true ? key : `${key}=${value}`))
      .filter((token) => token.length > 0)

    isupport.push(`BOUNCER=${this.options.serverName}`)

    for (let i = 0; i < isupport.length; i += 13) {
      this.fromServer('005', nick, ...isupport.slice(i, i + 13), 'are supported by this server')
    }

    const motd = upstream?.state.motdLines ?? []
    if (motd.length === 0) {
      this.fromServer('422', nick, 'MOTD File is missing')
    } else {
      this.fromServer('375', nick, `- ${networkName} Message of the Day -`)
      for (const line of motd) this.fromServer('372', nick, line)
      this.fromServer('376', nick, 'End of /MOTD command.')
    }
  }

  /**
   * Put the client in the channels this bouncer is already in.
   *
   * Without this an attaching client sees an empty window list and has to
   * `/join` its way back in — which on a channel with a key it does not have,
   * or one that is invite-only, it simply cannot do. The JOIN has to come from
   * the user's own nick, because that is the line every client watches for to
   * open a window.
   */
  private replayChannels(upstream: IRCClient | undefined): void {
    if (!upstream) return

    const nick = upstream.state.nick
    const mask = upstream.state.userHost ? `${nick}!${upstream.state.userHost}` : nick

    for (const channel of upstream.state.channels.values()) {
      this.write(`:${mask} JOIN ${channel.name}`)

      if (channel.topic) {
        this.fromServer('332', nick, channel.name, channel.topic)
        if (channel.topicSetBy && channel.topicSetAt) {
          const seconds = Math.floor(new Date(channel.topicSetAt).getTime() / 1000)
          this.fromServer('333', nick, channel.name, channel.topicSetBy, String(seconds))
        }
      }

      const names = [...channel.users.values()].map((user) => {
        // Only a client that asked for multi-prefix can read more than one
        const prefixes = this.caps.has('multi-prefix')
          ? user.prefixes.join('')
          : (user.prefixes[0] ?? '')
        return `${prefixes}${user.nick}`
      })

      for (let i = 0; i < names.length; i += 12) {
        this.fromServer('353', nick, '=', channel.name, names.slice(i, i + 12).join(' '))
      }
      this.fromServer('366', nick, channel.name, 'End of /NAMES list.')

      this.replayBacklog(channel.name)
    }
  }

  /**
   * The last of what was said while nobody was attached.
   *
   * Only for a client that asked for `server-time`. Without it every replayed
   * line arrives looking like it was said just now, and a conversation from
   * yesterday reads as one happening this second — worse than no backlog at
   * all, because the client cannot tell the difference.
   */
  private replayBacklog(target: string): void {
    if (!this.caps.has('server-time')) return
    if (!this.bound || !this.options.backlog) return

    const messages = this.options.backlog(this.bound.id, target, 50)
    if (messages.length === 0) return

    const batch = `sb${this.id}${Math.random().toString(36).slice(2, 8)}`
    const batched = this.caps.has('batch')

    if (batched) this.fromServer('BATCH', `+${batch}`, 'chathistory', target)
    for (const message of messages) {
      const tags = batched ? `@time=${message.time};batch=${batch} ` : `@time=${message.time} `
      const command = message.kind === 'notice' ? 'NOTICE' : 'PRIVMSG'
      this.write(`${tags}:${message.nick} ${command} ${target} :${message.text}`)
    }
    if (batched) this.fromServer('BATCH', `-${batch}`)
  }

  // ── Relaying ───────────────────────────────────────────────────

  private relayFrom(upstream: IRCClient): () => void {
    const onRaw = (direction: 'in' | 'out', line: string): void => {
      if (direction !== 'in') return
      this.relay(line)
    }

    upstream.events.on('raw', onRaw)
    return () => upstream.events.off('raw', onRaw)
  }

  /** One line from the network, trimmed to what this client agreed to receive */
  relay(line: string): void {
    let msg: IRCMessage
    try {
      msg = parseMessage(line)
    } catch {
      return
    }

    const command = msg.command.toUpperCase()
    if (NOT_RELAYED.has(command)) return

    /*
     * Our own words, back from the network, to a client that did not ask.
     *
     * With `echo-message` negotiated upstream the network returns everything we
     * say — which is what other attached clients need, and what a client that
     * never requested `echo-message` has no idea what to do with. Several show
     * it twice: once when they sent it, once when it came back.
     */
    if (
      !this.caps.has('echo-message') &&
      (command === 'PRIVMSG' || command === 'NOTICE' || command === 'TAGMSG') &&
      msg.source?.nick &&
      this.bound?.client &&
      msg.source.nick === this.bound.client.state.nick
    ) {
      return
    }

    /*
     * Tags the client did not ask for are removed, not passed on.
     *
     * A client that never negotiated `message-tags` has no parser for a line
     * beginning with `@`, and what it does with one ranges from ignoring the
     * message to disconnecting. Relaying verbatim is only correct for a client
     * that said it could read it.
     */
    const tags: Record<string, string | true> = {}
    for (const [key, value] of Object.entries(msg.tags)) {
      if (key === 'time' && this.caps.has('server-time')) tags[key] = value
      else if (key === 'batch' && this.caps.has('batch')) tags[key] = value
      else if (key === 'account' && this.caps.has('account-tag')) tags[key] = value
      else if (this.caps.has('message-tags')) tags[key] = value
    }

    // Time every line, whether or not the network did. A client that asked for
    // server-time and gets a line without it will stamp it itself, which is
    // right now — and right now is wrong for anything held even briefly.
    if (this.caps.has('server-time') && !tags['time']) {
      tags['time'] = new Date().toISOString()
    }

    this.write(serializeMessage({ ...msg, tags }))
  }

  /** What this client just said, to everyone else who is listening */
  private echo(msg: IRCMessage, upstream: IRCClient): void {
    const nick = upstream.state.nick
    const mask = upstream.state.userHost ? `${nick}!${upstream.state.userHost}` : nick
    const echoed = serializeMessage({
      ...msg,
      prefix: mask,
      tags: { ...msg.tags, time: new Date().toISOString() }
    })

    this.options.onEcho?.(this, upstream, echoed)
  }

  // ── Writing ────────────────────────────────────────────────────

  /**
   * A line this bouncer invented, sent as the bouncer.
   *
   * Every line a real server sends carries a source — `:irc.example.org 376
   * nick :End of /MOTD` — and a numeric without one is not something a client
   * has to accept. Several do not: the line is dropped, and what goes missing
   * is the welcome, which is the one burst a client cannot continue without.
   */
  private fromServer(command: string, ...params: string[]): void {
    this.write(`:${this.options.serverName} ${cmd(command, ...params)}`)
  }

  private numeric(code: string, text: string): void {
    this.fromServer(code, this.wantedNick, text)
  }

  write(line: string): void {
    if (this.closed || this.socket.destroyed) return
    this.socket.write(`${line}\r\n`)
  }

  private fail(reason: string): void {
    this.write(cmd('ERROR', reason))
    this.close()
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.detachRelay?.()
    this.detachRelay = null
    this.socket.destroy()
    this.onClose(this)
  }
}
