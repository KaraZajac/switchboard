import { describe, it, expect, beforeEach } from 'vitest'
import { EventEmitter } from 'events'
import { BouncerSession, type SessionOptions } from '../../src/main/bouncer/session'
import type { IRCClient } from '../../src/main/irc/client'

/**
 * A client attached to Switchboard's own bouncer.
 *
 * The behaviours here are the ones somebody notices within a minute of
 * attaching irssi: whether the welcome arrives at all, whether they land in
 * their channels, whether their own message comes back twice, and whether a
 * `QUIT` from one window takes the network down for every other device.
 */

/** Just enough socket to read what was written */
class FakeSocket extends EventEmitter {
  written: string[] = []
  destroyed = false

  setEncoding(): void {}
  setNoDelay(): void {}
  setTimeout(): void {}
  write(data: string): boolean {
    for (const line of data.split('\r\n')) if (line) this.written.push(line)
    return true
  }
  destroy(): void {
    this.destroyed = true
  }

  /** What the client sent us */
  feed(...lines: string[]): void {
    this.emit('data', lines.map((line) => `${line}\r\n`).join(''))
  }

  /** Lines matching a command, as whole strings */
  lines(command: string): string[] {
    return this.written.filter((line) => new RegExp(`(^|\\s)${command}(\\s|$)`).test(line))
  }
}

interface FakeUpstream {
  client: IRCClient
  sent: string[]
  raw: (line: string) => void
}

function fakeUpstream(options: { nick?: string; echoMessage?: boolean } = {}): FakeUpstream {
  const sent: string[] = []
  const events = new EventEmitter()
  const capabilities = new Set<string>(['multi-prefix'])
  if (options.echoMessage) capabilities.add('echo-message')

  const channels = new Map([
    [
      '#test',
      {
        name: '#test',
        topic: 'a topic',
        topicSetBy: 'someone',
        topicSetAt: '2026-01-01T00:00:00.000Z',
        users: new Map([
          ['kara', { nick: 'kara', prefixes: ['@', '+'] }],
          ['bunny', { nick: 'bunny', prefixes: [] }]
        ])
      }
    ]
  ])

  const client = {
    config: { host: 'irc.example.org' },
    connection: { sendRaw: (line: string) => sent.push(line) },
    state: {
      nick: options.nick ?? 'kara',
      userHost: 'kara@host',
      isupport: { CHANTYPES: '#', NETWORK: 'example' },
      motdLines: ['welcome'],
      channels,
      capabilities,
      registrationState: 'connected'
    },
    events
  } as unknown as IRCClient

  return { client, sent, raw: (line) => events.emit('raw', 'in', line) }
}

function attach(
  upstream: FakeUpstream,
  overrides: Partial<SessionOptions> = {}
): { socket: FakeSocket; session: BouncerSession } {
  const socket = new FakeSocket()
  const network = { id: 'net1', name: 'example', client: upstream.client }

  const session = new BouncerSession(
    socket as never,
    {
      serverName: 'switchboard',
      password: null,
      version: 'test',
      networks: {
        all: () => [network],
        find: (wanted) => (wanted === 'example' || wanted === 'net1' ? network : null)
      },
      ...overrides
    },
    () => {}
  )

  return { socket, session }
}

/** Register the way a modern client does */
function register(socket: FakeSocket, login = 'kara/example', caps = 'server-time'): void {
  socket.feed('CAP LS 302', 'NICK probe', `USER ${login} 0 * :probe`, `CAP REQ :${caps}`, 'CAP END')
}

describe('attaching a client to the bouncer', () => {
  let upstream: FakeUpstream

  beforeEach(() => {
    upstream = fakeUpstream()
  })

  it('welcomes it under the nick the network gave us, not the one it asked for', () => {
    const { socket } = attach(upstream)
    register(socket)

    // A client that gets `probe` back will address everything to a nick that is
    // not on the network
    expect(socket.lines('001')[0]).toContain('kara')
    expect(socket.lines('001')[0]).not.toContain('probe')
  })

  it('puts a source on everything it makes up', () => {
    const { socket } = attach(upstream)
    register(socket)

    // A numeric with no prefix is not something a client has to accept, and
    // several drop it — taking the welcome with it
    for (const line of socket.written) {
      if (/^(ERROR|AUTHENTICATE)/.test(line)) continue
      expect(line.startsWith(':') || line.startsWith('@')).toBe(true)
    }

    // The numerics come from the bouncer; the replayed JOIN comes from the
    // user, which is the whole reason a client opens a window for it
    for (const line of socket.written.filter((l) => /^:\S+ \d{3} /.test(l))) {
      expect(line.startsWith(':switchboard ')).toBe(true)
    }
    expect(socket.written).toContain(':kara!kara@host JOIN #test')
  })

  it('passes the network own limits through rather than inventing its own', () => {
    const { socket } = attach(upstream)
    register(socket)

    const isupport = socket.lines('005').join(' ')
    expect(isupport).toContain('CHANTYPES=#')
    expect(isupport).toContain('NETWORK=example')
  })

  it('lands the client in the channels the bouncer is already in', () => {
    const { socket } = attach(upstream)
    register(socket)

    // The JOIN has to come from the user's own mask: that is the line every
    // client watches for to open a window
    expect(socket.written).toContain(':kara!kara@host JOIN #test')
    expect(socket.lines('332')[0]).toContain('a topic')
    expect(socket.lines('353')[0]).toContain('bunny')
    expect(socket.lines('366')).toHaveLength(1)
  })

  it('gives one prefix to a client that cannot read two', () => {
    const { socket } = attach(upstream)
    register(socket)

    // `@+kara` to a client without multi-prefix is a nick called `+kara`
    expect(socket.lines('353')[0]).toContain('@kara')
    expect(socket.lines('353')[0]).not.toContain('@+kara')
  })

  it('gives every prefix to a client that asked for them', () => {
    const { socket } = attach(upstream)
    register(socket, 'kara/example', 'server-time multi-prefix')

    expect(socket.lines('353')[0]).toContain('@+kara')
  })

  it('binds a plain client to the only network there is', () => {
    const { socket } = attach(upstream)
    // No `/network` in the login, the way an unmodified irssi config arrives
    register(socket, 'kara')

    expect(socket.written).toContain(':kara!kara@host JOIN #test')
  })
})

describe('what an attached client may do', () => {
  it('does not take the network down when one client quits', () => {
    const upstream = fakeUpstream()
    const { socket } = attach(upstream)
    register(socket)

    socket.feed('QUIT :bye')

    // The one thing a bouncer exists to prevent
    expect(upstream.sent.join(' ')).not.toContain('QUIT')
    expect(socket.destroyed).toBe(true)
  })

  it('answers its own pings rather than passing them on', () => {
    const upstream = fakeUpstream()
    const { socket } = attach(upstream)
    register(socket)
    upstream.sent.length = 0

    socket.feed('PING :abc')

    expect(socket.lines('PONG')[0]).toContain('abc')
    expect(upstream.sent).toHaveLength(0)
  })

  it('sends everything else on to the network', () => {
    const upstream = fakeUpstream()
    const { socket } = attach(upstream)
    register(socket)
    upstream.sent.length = 0

    socket.feed('JOIN #somewhere')

    expect(upstream.sent).toContain('JOIN #somewhere')
  })

  it('refuses a bad password without saying which part was wrong', () => {
    const upstream = fakeUpstream()
    const { socket } = attach(upstream, { password: 'right' })
    socket.feed('PASS wrong', 'NICK probe', 'USER kara/example 0 * :probe')

    expect(socket.lines('464')).toHaveLength(1)
    expect(socket.destroyed).toBe(true)
  })

  it('lets a good password through', () => {
    const upstream = fakeUpstream()
    const { socket } = attach(upstream, { password: 'right' })
    socket.feed('PASS right', 'NICK probe', 'USER kara/example 0 * :probe')

    expect(socket.lines('001')).toHaveLength(1)
    expect(socket.destroyed).toBe(false)
  })
})

describe('relaying what the network says', () => {
  it('strips tags from a client that never asked to read them', () => {
    const upstream = fakeUpstream()
    const { socket } = attach(upstream)
    // No server-time, no message-tags
    socket.feed('NICK probe', 'USER kara/example 0 * :probe')
    socket.written.length = 0

    upstream.raw('@time=2026-01-01T00:00:00.000Z :bunny!b@h PRIVMSG #test :hello')

    // A client with no parser for a leading `@` does anything from ignoring the
    // line to disconnecting
    expect(socket.written).toEqual([':bunny!b@h PRIVMSG #test :hello'])
  })

  it('times a line the network did not time, for a client that asked', () => {
    const upstream = fakeUpstream()
    const { socket } = attach(upstream)
    register(socket)
    socket.written.length = 0

    upstream.raw(':bunny!b@h PRIVMSG #test :hello')

    // Without this the client stamps it itself, and "now" is wrong for anything
    // that was held even briefly
    expect(socket.written[0]).toMatch(/^@time=\d{4}-/)
  })

  it('keeps the registration burst to itself', () => {
    const upstream = fakeUpstream()
    const { socket } = attach(upstream)
    register(socket)
    socket.written.length = 0

    upstream.raw(':irc.example.org 001 kara :Welcome')
    upstream.raw(':irc.example.org 376 kara :End of MOTD')
    upstream.raw('PING :x')

    // A second welcome every time the upstream reconnects resets a client's
    // idea of the whole session
    expect(socket.written).toEqual([])
  })

  it('does not hand a reconnecting network an ERROR to act on', () => {
    const upstream = fakeUpstream()
    const { socket } = attach(upstream)
    register(socket)
    socket.written.length = 0

    upstream.raw('ERROR :Closing link')

    // The client's connection outlives the upstream's; telling it otherwise is
    // how an attached client quits when the network hiccups
    expect(socket.written).toEqual([])
  })

  it('does not hand back a message the client just sent, unasked', () => {
    const upstream = fakeUpstream({ echoMessage: true })
    const { socket } = attach(upstream)
    register(socket)
    socket.written.length = 0

    upstream.raw(':kara!kara@host PRIVMSG #test :something I said')

    expect(socket.written).toEqual([])
  })

  it('does hand it back to a client that asked for echo-message', () => {
    const upstream = fakeUpstream({ echoMessage: true })
    const { socket } = attach(upstream)
    register(socket, 'kara/example', 'server-time echo-message')
    socket.written.length = 0

    upstream.raw(':kara!kara@host PRIVMSG #test :something I said')

    expect(socket.written.join(' ')).toContain('something I said')
  })
})

describe('echoing to the other clients', () => {
  it('echoes locally when the network will not', () => {
    const upstream = fakeUpstream({ echoMessage: false })
    const echoed: string[] = []
    const { socket } = attach(upstream, { onEcho: (_from, _up, line) => echoed.push(line) })
    register(socket)

    socket.feed('PRIVMSG #test :hello everyone')

    expect(echoed.join(' ')).toContain('hello everyone')
    expect(echoed[0]).toContain(':kara!kara@host')
  })

  it('leaves it to the network when the network does it', () => {
    const upstream = fakeUpstream({ echoMessage: true })
    const echoed: string[] = []
    const { socket } = attach(upstream, { onEcho: (_from, _up, line) => echoed.push(line) })
    register(socket)

    socket.feed('PRIVMSG #test :hello everyone')

    // The network's copy carries the real msgid, which is what a reply, a
    // reaction and a redaction are addressed to
    expect(echoed).toEqual([])
    expect(upstream.sent).toContain('PRIVMSG #test :hello everyone')
  })
})

describe('the backlog a client gets on attaching', () => {
  it('replays what was said while nobody was here', () => {
    const upstream = fakeUpstream()
    const { socket } = attach(upstream, {
      backlog: () => [{ time: '2026-01-01T00:00:00.000Z', nick: 'bunny', text: 'said earlier' }]
    })
    register(socket, 'kara/example', 'server-time batch')

    const replayed = socket.written.filter((line) => line.includes('said earlier'))
    expect(replayed).toHaveLength(1)
    expect(replayed[0]).toContain('@time=2026-01-01T00:00:00.000Z')
    expect(socket.lines('BATCH')).toHaveLength(2)
  })

  it('replays nothing to a client that cannot tell when it was said', () => {
    const upstream = fakeUpstream()
    const { socket } = attach(upstream, {
      backlog: () => [{ time: '2026-01-01T00:00:00.000Z', nick: 'bunny', text: 'said earlier' }]
    })
    // No server-time: every line would read as happening this second, which is
    // worse than no backlog because the client cannot tell
    register(socket, 'kara/example', 'message-tags')

    expect(socket.written.join(' ')).not.toContain('said earlier')
  })
})

describe('managing networks from an attached client', () => {
  it('refuses to add one when the bouncer was not given a way', () => {
    const upstream = fakeUpstream()
    const { socket } = attach(upstream)
    register(socket)
    socket.written.length = 0

    socket.feed('BOUNCER ADDNETWORK name=new;host=irc.example.net')

    // Silence would look like it worked
    expect(socket.lines('FAIL')).toHaveLength(1)
  })

  it('adds one and answers with the id it was given', () => {
    const upstream = fakeUpstream()
    const { socket } = attach(upstream, {
      manage: {
        add: () => ({ id: 'net2', error: null }),
        change: () => ({ error: null }),
        remove: () => ({ error: null })
      }
    })
    register(socket)
    socket.written.length = 0

    socket.feed('BOUNCER ADDNETWORK name=new;host=irc.example.net')

    expect(socket.lines('BOUNCER')[0]).toContain('net2')
  })

  it('lists what it holds', () => {
    const upstream = fakeUpstream()
    const { socket } = attach(upstream)
    register(socket)
    socket.written.length = 0

    socket.feed('BOUNCER LISTNETWORKS')

    const listed = socket.lines('BOUNCER')
    expect(listed[0]).toContain('net1')
    expect(listed[0]).toContain('name=example')
    expect(listed[0]).toContain('state=connected')
  })
})
