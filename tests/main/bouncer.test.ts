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
  const capabilities = new Set<string>([
    'multi-prefix',
    'draft/message-edit',
    'draft/message-redaction',
    'draft/metadata-2',
    'typing',
    'draft/react',
    'sasl',
    'draft/webpush'
  ])
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

describe('answering CHATHISTORY from what the bouncer kept', () => {
  const stored = [
    { time: '2026-01-01T10:00:00.000Z', nick: 'bunny', text: 'first', msgid: 'm1' },
    { time: '2026-01-01T11:00:00.000Z', nick: 'bunny', text: 'second', msgid: 'm2' }
  ]

  const withHistory = (upstream: FakeUpstream): { socket: FakeSocket; asked: unknown[] } => {
    const asked: unknown[] = []
    const { socket } = attach(upstream, {
      history: {
        messages: (serverId, target, window) => {
          asked.push({ serverId, target, window })
          return stored
        },
        targets: () => [{ target: '#test', latest: '2026-01-01T11:00:00.000Z' }]
      }
    })
    return { socket, asked }
  }

  it('serves a network that keeps none itself', () => {
    const upstream = fakeUpstream()
    const { socket, asked } = withHistory(upstream)
    register(socket, 'kara/example', 'server-time batch')
    socket.written.length = 0
    upstream.sent.length = 0

    socket.feed('CHATHISTORY LATEST #test * 100')

    expect(socket.written.join(' ')).toContain('first')
    expect(asked).toHaveLength(1)
    // The network cannot answer, so nothing should be asked of it
    expect(upstream.sent).toEqual([])
  })

  it('leaves it to a network that keeps more than we do', () => {
    const upstream = fakeUpstream()
    upstream.client.state.capabilities.add('draft/chathistory')
    const { socket, asked } = withHistory(upstream)
    register(socket, 'kara/example', 'server-time batch')
    upstream.sent.length = 0

    socket.feed('CHATHISTORY LATEST #test * 100')

    expect(asked).toEqual([])
    expect(upstream.sent).toContain('CHATHISTORY LATEST #test * 100')
  })

  it('pages backwards from a timestamp', () => {
    const upstream = fakeUpstream()
    const { socket, asked } = withHistory(upstream)
    register(socket, 'kara/example', 'server-time batch')

    socket.feed('CHATHISTORY BEFORE #test timestamp=2026-01-01T12:00:00.000Z 50')

    expect(asked[0]).toMatchObject({
      target: '#test',
      window: { before: '2026-01-01T12:00:00.000Z', limit: 50 }
    })
  })

  it('pages forwards from a timestamp', () => {
    const upstream = fakeUpstream()
    const { socket, asked } = withHistory(upstream)
    register(socket, 'kara/example', 'server-time batch')

    socket.feed('CHATHISTORY AFTER #test timestamp=2026-01-01T09:00:00.000Z 50')

    expect(asked[0]).toMatchObject({ window: { after: '2026-01-01T09:00:00.000Z' } })
  })

  it('passes on a selector it cannot answer rather than answering another question', () => {
    const upstream = fakeUpstream()
    const { socket, asked } = withHistory(upstream)
    register(socket, 'kara/example', 'server-time batch')
    upstream.sent.length = 0

    // A msgid selector needs the id to be findable, and a network that keeps
    // no history has not given us many
    socket.feed('CHATHISTORY BEFORE #test msgid=abc 50')

    expect(asked).toEqual([])
    expect(upstream.sent).toContain('CHATHISTORY BEFORE #test msgid=abc 50')
  })

  it('does not answer a client that cannot tell when a line was said', () => {
    const upstream = fakeUpstream()
    const { socket, asked } = withHistory(upstream)
    register(socket, 'kara/example', 'batch')
    socket.written.length = 0

    socket.feed('CHATHISTORY LATEST #test * 100')

    expect(asked).toEqual([])
    expect(socket.lines('FAIL')).toHaveLength(1)
  })

  it('keeps an outlandish limit to something a socket can carry', () => {
    const upstream = fakeUpstream()
    const { socket, asked } = withHistory(upstream)
    register(socket, 'kara/example', 'server-time batch')

    socket.feed('CHATHISTORY LATEST #test * 99999999')

    expect(asked[0]).toMatchObject({ window: { limit: 1000 } })
  })

  it('names the conversations that had anything in them', () => {
    const upstream = fakeUpstream()
    const { socket } = withHistory(upstream)
    register(socket, 'kara/example', 'server-time batch')
    socket.written.length = 0

    socket.feed(
      'CHATHISTORY TARGETS timestamp=2026-01-01T00:00:00.000Z timestamp=2026-01-02T00:00:00.000Z 50'
    )

    // How a client finds the direct message that arrived while it was away
    expect(socket.lines('CHATHISTORY')[0]).toContain('#test')
  })

  it('carries the msgid so a reply can be addressed to it', () => {
    const upstream = fakeUpstream()
    const { socket } = withHistory(upstream)
    register(socket, 'kara/example', 'server-time batch message-tags')
    socket.written.length = 0

    socket.feed('CHATHISTORY LATEST #test * 10')

    expect(socket.written.find((line) => line.includes('first'))).toContain('msgid=m1')
  })
})

describe('when the network goes and comes back', () => {
  it('follows the connection to a new object rather than going quiet', () => {
    const first = fakeUpstream()
    const { socket, session } = attach(first)
    register(socket)

    // Reconnecting through the manager builds a new IRCClient; a session
    // holding the old one keeps a subscription to an emitter nothing will ever
    // emit on again — attached, no error, receiving nothing
    const second = fakeUpstream({ nick: 'kara2' })
    session.networkBack({ id: 'net1', name: 'example', client: second.client })
    socket.written.length = 0

    second.raw(':bunny!b@h PRIVMSG #test :after the reconnect')
    first.raw(':bunny!b@h PRIVMSG #test :from the dead one')

    expect(socket.written.join(' ')).toContain('after the reconnect')
    expect(socket.written.join(' ')).not.toContain('from the dead one')
  })

  it('does not welcome the client a second time', () => {
    const upstream = fakeUpstream()
    const { socket, session } = attach(upstream)
    register(socket)
    socket.written.length = 0

    session.networkBack({ id: 'net1', name: 'example', client: upstream.client })

    // A fresh 001 every time a network hiccups resets a client's idea of the
    // whole session
    expect(socket.lines('001')).toEqual([])
    // But the windows are stale, so the channels come back
    expect(socket.written).toContain(':kara!kara@host JOIN #test')
  })

  it('does not replay the backlog again', () => {
    const upstream = fakeUpstream()
    const { socket, session } = attach(upstream, {
      backlog: () => [{ time: '2026-01-01T00:00:00.000Z', nick: 'bunny', text: 'said earlier' }]
    })
    register(socket, 'kara/example', 'server-time batch')
    socket.written.length = 0

    session.networkBack({ id: 'net1', name: 'example', client: upstream.client })

    // The client has been watching it arrive live
    expect(socket.written.join(' ')).not.toContain('said earlier')
  })

  it('says the network went, without ending the client connection', () => {
    const upstream = fakeUpstream()
    const { socket, session } = attach(upstream)
    register(socket)
    socket.written.length = 0

    session.networkLost('Connection reset')

    expect(socket.lines('NOTICE')[0]).toContain('Connection reset')
    expect(socket.lines('ERROR')).toEqual([])
    expect(socket.destroyed).toBe(false)
  })

  it('leaves a session bound elsewhere alone', () => {
    const upstream = fakeUpstream()
    const { socket, session } = attach(upstream)
    register(socket)
    socket.written.length = 0

    session.networkBack({ id: 'other', name: 'somewhere else', client: upstream.client })

    expect(socket.written).toEqual([])
  })
})

describe('what an attached client is offered', () => {
  it('offers on everything the network agreed to send', () => {
    const upstream = fakeUpstream()
    const { socket } = attach(upstream)
    socket.feed('CAP LS 302')

    const offered = socket.lines('CAP')[0] ?? ''
    // An allowlist quietly dropped every one of these, so edits, redactions,
    // profiles, typing and reactions all stopped at the bouncer
    for (const name of [
      'draft/message-edit',
      'draft/message-redaction',
      'draft/metadata-2',
      'typing',
      'draft/react'
    ]) {
      expect(offered).toContain(name)
    }
  })

  it("keeps the network's own sasl to itself", () => {
    const upstream = fakeUpstream()
    const { socket } = attach(upstream)
    socket.feed('CAP LS 302')

    const offered = socket.lines('CAP')[0] ?? ''
    // The bouncer offers a sasl of its own, for logging in to the bouncer.
    // Offering the network's would invite a client to authenticate to a
    // network it has no connection to.
    expect(offered).toContain('sasl=PLAIN')
    expect(offered).not.toContain('draft/webpush')
  })

  it('carries a client tag both ways once message-tags is on', () => {
    const upstream = fakeUpstream()
    const { socket } = attach(upstream)
    register(socket, 'kara/example', 'server-time message-tags')
    socket.written.length = 0
    upstream.sent.length = 0

    socket.feed('@+typing=active TAGMSG #test')
    expect(upstream.sent).toContain('@+typing=active TAGMSG #test')

    upstream.raw('@+reply=abc;+draft/react=\u{1F44D};msgid=x :bunny!b@h TAGMSG #test')
    const relayed = socket.written.join(' ')
    expect(relayed).toContain('+reply=abc')
    expect(relayed).toContain('+draft/react=')
    expect(relayed).toContain('msgid=x')
  })

  it('passes an edit and a redaction through untouched', () => {
    const upstream = fakeUpstream()
    const { socket } = attach(upstream)
    register(socket, 'kara/example', 'server-time message-tags')
    socket.written.length = 0
    upstream.sent.length = 0

    socket.feed('REDACT #test abc :a longer reason')
    // The wire form of a single-word trailing parameter is the serializer's
    // business; what must survive is a reason with a space in it staying one
    // parameter
    expect(upstream.sent).toContain('REDACT #test abc :a longer reason')

    upstream.raw(':bunny!b@h REDACT #test abc :tidy')
    upstream.raw('@+draft/edit=abc :bunny!b@h PRIVMSG #test :fixed')
    expect(socket.written.join(' ')).toContain('REDACT #test abc')
    expect(socket.written.join(' ')).toContain('+draft/edit=abc')
  })
})

describe('what a client is allowed to claim', () => {
  it('will not let a client sign a line as somebody else', () => {
    const upstream = fakeUpstream()
    const { socket } = attach(upstream)
    register(socket, 'kara/example', 'server-time message-tags')
    upstream.sent.length = 0

    socket.feed(':someone-else!x@y PRIVMSG #test :not from them')

    expect(upstream.sent).toContain('PRIVMSG #test :not from them')
    expect(upstream.sent.join(' ')).not.toContain('someone-else')
  })

  it('will not let a client set the tags the network assigns', () => {
    const upstream = fakeUpstream()
    const { socket } = attach(upstream)
    register(socket, 'kara/example', 'server-time message-tags')
    upstream.sent.length = 0

    socket.feed('@msgid=forged;time=1999-01-01T00:00:00.000Z;+reply=abc PRIVMSG #test :hello')

    const sent = upstream.sent.join(' ')
    // Claiming a message was sent at a time it was not
    expect(sent).not.toContain('msgid=forged')
    expect(sent).not.toContain('1999')
    // But the client tag is exactly the kind a client is meant to set
    expect(sent).toContain('+reply=abc')
  })

  it('keeps a label, because that is how the answer finds its way back', () => {
    const upstream = fakeUpstream()
    const { socket } = attach(upstream)
    register(socket, 'kara/example', 'server-time message-tags')
    upstream.sent.length = 0

    socket.feed('@label=xyz WHOIS bunny')

    expect(upstream.sent.join(' ')).toContain('label=xyz')
  })
})

describe('what the bouncer does not pass on', () => {
  it("keeps the network's filehost to itself", () => {
    const upstream = fakeUpstream()
    upstream.client.state.isupport['draft/FILEHOST'] = 'https://files.example.org/upload'
    const { socket } = attach(upstream)
    register(socket)

    /*
     * The spec makes a client send its SASL credentials to the upload URI, and
     * through a bouncer those are the bouncer's — so sharing a photograph
     * would hand one service's password to another.
     */
    expect(socket.lines('005').join(' ')).not.toContain('FILEHOST')
    // Everything else still goes
    expect(socket.lines('005').join(' ')).toContain('CHANTYPES=#')
  })
})

describe('a question the bouncer has already answered', () => {
  const X = String.fromCharCode(1)
  const ctcp = (verb: string) => `:asker!a@b PRIVMSG kara :${X}${verb}${X}`

  it('does not pass it on for the attached client to answer as well', () => {
    const upstream = fakeUpstream()
    const { socket } = attach(upstream)
    register(socket)
    socket.written.length = 0

    upstream.raw(ctcp('VERSION'))
    upstream.raw(ctcp('SOURCE'))
    upstream.raw(ctcp('CLIENTINFO'))

    // The bouncer's own connection answers these before this runs. Relaying
    // them meant a single VERSION came back twice, from two clients claiming
    // two different versions of the same program.
    expect(socket.written).toEqual([])
  })

  it('does not pass on a channel-wide one either, having answered that too', () => {
    const upstream = fakeUpstream()
    const { socket } = attach(upstream)
    register(socket)
    socket.written.length = 0

    upstream.raw(`:asker!a@b PRIVMSG #test :${X}VERSION${X}`)

    expect(socket.written).toEqual([])
  })

  it('passes on an action, which is not a question', () => {
    const upstream = fakeUpstream()
    const { socket } = attach(upstream)
    register(socket)
    socket.written.length = 0

    upstream.raw(`:bunny!b@h PRIVMSG #test :${X}ACTION waves${X}`)

    expect(socket.written.join(' ')).toContain('ACTION waves')
  })

  it('passes on a file offer, which it does not answer', () => {
    const upstream = fakeUpstream()
    const { socket } = attach(upstream)
    register(socket)
    socket.written.length = 0

    // Swallowing this would mean a file sent to somebody attached here never
    // reaches them
    upstream.raw(`:bunny!b@h PRIVMSG kara :${X}DCC SEND cat.png 2130706433 5000 84${X}`)

    expect(socket.written.join(' ')).toContain('DCC SEND cat.png')
  })
})

describe('speaking soju.im/bouncer-networks the way soju does', () => {
  const manage = {
    add: () => ({ id: 'net2', error: null }),
    change: () => ({ error: null }),
    remove: () => ({ error: null })
  }

  it('answers LISTNETWORKS in a batch, which is how the list ends', () => {
    const upstream = fakeUpstream()
    const { socket } = attach(upstream)
    register(socket, 'kara', 'batch soju.im/bouncer-networks')
    socket.written.length = 0

    socket.feed('BOUNCER LISTNETWORKS')

    // There is no closing numeric in the extension and soju sends none. This
    // used to send a RPL_LISTEND of its own invention, so a client following
    // the extension waited for an end that never came.
    const batches = socket.lines('BATCH')
    expect(batches[0]).toContain('soju.im/bouncer-networks')
    expect(batches).toHaveLength(2)
    expect(socket.written.join(' ')).not.toContain('RPL_LISTEND')
    expect(socket.written.join(' ')).toContain('BOUNCER NETWORK net1')
  })

  it('refuses a bind once registration is over', () => {
    const upstream = fakeUpstream()
    const { socket } = attach(upstream)
    register(socket)
    socket.written.length = 0

    socket.feed('BOUNCER BIND net1')

    expect(socket.lines('FAIL')[0]).toBe(
      ':switchboard FAIL BOUNCER REGISTRATION_IS_COMPLETED BIND :Cannot bind to a network after registration'
    )
  })

  it('binds what was asked for before CAP END, once registration finishes', () => {
    const upstream = fakeUpstream()
    const { socket } = attach(upstream)
    socket.feed('CAP LS 302', 'NICK probe', 'USER kara 0 * :probe', 'BOUNCER BIND net1', 'CAP END')

    // The welcome has to carry the network's own name and limits, so the bind
    // happens before it goes out rather than after
    expect(socket.lines('001')[0]).toContain('example')
    expect(socket.written).toContain(':kara!kara@host JOIN #test')
  })

  it('puts the subcommand in every FAIL, as the grammar says', () => {
    const upstream = fakeUpstream()
    const { socket } = attach(upstream, { manage })
    register(socket)
    socket.written.length = 0

    socket.feed('BOUNCER DELNETWORK nope')
    socket.feed('BOUNCER NONSENSE')

    // `FAIL BOUNCER <code> <subcommand> [context…] :<description>`. Two of
    // these left the subcommand out, which reads as a context word to a client
    // following the grammar.
    expect(socket.lines('FAIL')[0]).toContain('DELNETWORK')
    expect(socket.lines('FAIL')[1]).toContain('UNKNOWN_COMMAND NONSENSE')
  })

  it('will not let a client set what the bouncer reports', () => {
    const upstream = fakeUpstream()
    const { socket } = attach(upstream, { manage })
    register(socket)
    socket.written.length = 0

    socket.feed('BOUNCER CHANGENETWORK net1 state=connected')

    // Quietly ignoring it leaves the client with no way to tell it was ignored
    expect(socket.lines('FAIL')[0]).toContain('UNKNOWN_ATTRIBUTE CHANGENETWORK state')
  })

  it('needs at least one attribute to change', () => {
    const upstream = fakeUpstream()
    const { socket } = attach(upstream, { manage })
    register(socket)
    socket.written.length = 0

    socket.feed('BOUNCER CHANGENETWORK net1')

    expect(socket.lines('FAIL')[0]).toContain('NEED_ATTRIBUTE CHANGENETWORK')
  })

  it('tells a client that asked to be told when the networks change', () => {
    const upstream = fakeUpstream()
    const { socket, session } = attach(upstream)
    register(socket, 'kara', 'batch soju.im/bouncer-networks soju.im/bouncer-networks-notify')
    socket.written.length = 0

    session.networksChanged()

    // The capability was advertised and then nothing was ever sent after the
    // first batch, so a client that asked to be told sat on a stale list
    expect(socket.written.join(' ')).toContain('BOUNCER NETWORK net1')
  })

  it('says a removed network is gone in the shape the extension uses', () => {
    const upstream = fakeUpstream()
    const { socket, session } = attach(upstream)
    register(socket, 'kara', 'batch soju.im/bouncer-networks soju.im/bouncer-networks-notify')
    socket.written.length = 0

    session.networksChanged('net1')

    expect(socket.written.join(' ')).toContain('BOUNCER NETWORK net1 *')
  })

  it('says nothing to a client that did not ask to be told', () => {
    const upstream = fakeUpstream()
    const { socket, session } = attach(upstream)
    register(socket, 'kara', 'batch')
    socket.written.length = 0

    session.networksChanged()

    expect(socket.written).toEqual([])
  })

  it('tells an unbound client there are no channels here', () => {
    const upstream = fakeUpstream()
    const network = { id: 'net1', name: 'example', client: upstream.client }
    const socket = new FakeSocket()
    new BouncerSession(
      socket as never,
      {
        serverName: 'switchboard',
        password: null,
        version: 'test',
        // Two networks, so nothing is bound by default
        networks: {
          all: () => [network, { ...network, id: 'net2', name: 'other' }],
          find: () => null
        }
      },
      () => {}
    )
    register(socket, 'kara', 'batch soju.im/bouncer-networks')

    // A client told `CHANTYPES=#` while bound to nothing offers a join box
    // that can only fail
    expect(socket.lines('005').join(' ')).toContain('CHANTYPES=')
    expect(socket.lines('005').join(' ')).not.toContain('CHANTYPES=#')
  })
})
