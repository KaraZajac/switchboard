import { describe, it, expect, beforeEach } from 'vitest'
import { runCommand } from '../../src/main/irc/commands'
import { serializeMessage } from '../../src/main/irc/serializer'
import { readFileSync } from 'fs'
import { join } from 'path'

interface Call {
  method: string
  args: unknown[]
}

let calls: Call[] = []

function record(method: string) {
  return (...args: unknown[]) => {
    calls.push({ method, args })
  }
}

/** Stands in for IRCClient — records what a command asked the client to do */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const client = {
  action: record('action'),
  join: record('join'),
  part: record('part'),
  setNick: record('setNick'),
  say: record('say'),
  notice: record('notice'),
  whois: record('whois'),
  setTopic: record('setTopic'),
  mode: record('mode'),
  kick: record('kick'),
  disconnect: record('disconnect'),
  connection: {
    send: record('send'),
    sendRaw: record('sendRaw')
  },
  // What the server said it will take. Empty by default — a server that states
  // nothing places no limit, which is the case most of these run under.
  state: { isupport: {} as Record<string, string | true> }
} as any

const run = (text: string, target = '#chan') => runCommand(client, target, text)

beforeEach(() => {
  calls = []
  // A server that states nothing places no limit, which is what most of these
  // run under; the cases that care set their own.
  client.state.isupport = {}
})

describe('slash commands', () => {
  it('leaves ordinary text alone', () => {
    expect(run('hello there').handled).toBe(false)
    expect(calls).toEqual([])
  })

  it('sends a literal message for a doubled slash', () => {
    const result = run('//not a command')
    expect(result.handled).toBe(false)
    expect(result.message).toBe('/not a command')
  })

  it('never sends an unknown command as a message', () => {
    const result = run('/definitelynotacommand some args')
    expect(result.handled).toBe(true)
    expect(result.message).toBeUndefined()
    expect(result.error).toMatch(/unknown command/i)
    expect(calls).toEqual([])
  })

  it('keeps /msg out of the channel', () => {
    // The bug this guards: "/msg NickServ IDENTIFY hunter2" as a public message
    const result = run('/msg NickServ IDENTIFY hunter2')
    expect(result.handled).toBe(true)
    expect(result.error).toBeUndefined()
    expect(calls).toEqual([{ method: 'say', args: ['NickServ', 'IDENTIFY hunter2'] }])
  })

  it('runs /me as an action', () => {
    run('/me waves hello')
    expect(calls).toEqual([{ method: 'action', args: ['#chan', 'waves hello'] }])
  })

  it('joins a channel, adding the # when left off', () => {
    run('/join #foo')
    run('/join bar')
    run('/join #baz secretkey')
    expect(calls).toEqual([
      { method: 'join', args: ['#foo', undefined] },
      { method: 'join', args: ['#bar', undefined] },
      { method: 'join', args: ['#baz', 'secretkey'] }
    ])
  })

  it('parts the current channel by default, or a named one', () => {
    run('/part')
    run('/part later everyone')
    run('/part #other bye')
    expect(calls).toEqual([
      { method: 'part', args: ['#chan', undefined] },
      { method: 'part', args: ['#chan', 'later everyone'] },
      { method: 'part', args: ['#other', 'bye'] }
    ])
  })

  it('sets and queries the topic', () => {
    run('/topic')
    run('/topic a brand new topic')
    expect(calls).toEqual([
      { method: 'send', args: ['TOPIC', '#chan'] },
      { method: 'setTopic', args: ['#chan', 'a brand new topic'] }
    ])
  })

  it('applies /mode to the current channel when given only flags', () => {
    run('/mode +o someone')
    expect(calls).toEqual([{ method: 'mode', args: ['#chan', '+o', 'someone'] }])
  })

  it('applies /mode to an explicit target', () => {
    run('/mode #other +m')
    expect(calls).toEqual([{ method: 'mode', args: ['#other', '+m'] }])
  })

  it('kicks with an optional reason', () => {
    run('/kick troublemaker being rude')
    expect(calls).toEqual([{ method: 'kick', args: ['#chan', 'troublemaker', 'being rude'] }])
  })

  it('refuses channel-only commands in a DM', () => {
    expect(run('/kick someone', 'alice').error).toMatch(/only works in a channel/)
    expect(run('/topic new', 'alice').error).toMatch(/only works in a channel/)
    expect(calls).toEqual([])
  })

  it('sets and clears away', () => {
    run('/away making coffee')
    run('/away')
    run('/back')
    expect(calls).toEqual([
      { method: 'send', args: ['AWAY', 'making coffee'] },
      { method: 'send', args: ['AWAY'] },
      { method: 'send', args: ['AWAY'] }
    ])
  })

  it('reports usage instead of acting on an incomplete command', () => {
    expect(run('/join').error).toMatch(/usage/i)
    expect(run('/nick').error).toMatch(/usage/i)
    expect(run('/msg someone').error).toMatch(/nothing to send/i)
    expect(calls).toEqual([])
  })

  it('passes /raw through untouched', () => {
    run('/raw PRIVMSG #chan :hi')
    expect(calls).toEqual([{ method: 'sendRaw', args: ['PRIVMSG #chan :hi'] }])
  })
})

/**
 * Limits the server states but does not enforce with an error.
 *
 * `TOPICLEN` and its neighbours are not refusals: go over one and the server
 * accepts the command and quietly keeps the first N bytes, so the user finds
 * out later, if at all.
 */
describe('text the server would silently cut', () => {
  beforeEach(() => {
    client.state.isupport = { TOPICLEN: '20', AWAYLEN: '10', KICKLEN: '8' }
  })

  it('refuses a topic too long for this network, and says by how much', () => {
    const result = run(`/topic ${'t'.repeat(40)}`)

    expect(result.error).toContain('20')
    expect(result.error).toContain('40')
    expect(calls.find((c) => c.method === 'setTopic')).toBeUndefined()
  })

  it('lets a topic that fits through', () => {
    run('/topic a short one')
    expect(calls).toContainEqual({ method: 'setTopic', args: ['#chan', 'a short one'] })
  })

  it('refuses an away message too long for this network', () => {
    expect(run(`/away ${'a'.repeat(30)}`).error).toContain('10')
    expect(calls.find((c) => c.method === 'send')).toBeUndefined()
  })

  /** Clearing it is not a message, so there is nothing to be too long */
  it('still lets you come back', () => {
    run('/away')
    expect(calls).toContainEqual({ method: 'send', args: ['AWAY'] })
  })

  it('refuses a kick reason too long for this network', () => {
    expect(run(`/kick robin ${'r'.repeat(20)}`).error).toContain('8')
    expect(calls.find((c) => c.method === 'kick')).toBeUndefined()
  })

  it('kicks with no reason at all regardless', () => {
    run('/kick robin')
    expect(calls).toContainEqual({ method: 'kick', args: ['#chan', 'robin', undefined] })
  })

  /** Bytes, not characters — which is what the server counts */
  it('counts a limit in bytes rather than characters', () => {
    client.state.isupport = { TOPICLEN: '10' }

    // Five characters, fifteen bytes
    expect(run('/topic 日本語です').error).toContain('15')
  })

  it('places no limit when the server states none', () => {
    client.state.isupport = {}
    run(`/topic ${'t'.repeat(500)}`)

    expect(calls.find((c) => c.method === 'setTopic')).toBeDefined()
  })
})

/**
 * The new commands, as lines on the wire.
 *
 * Compared against `tests/fixtures/commands.json`, which the Android
 * `CommandsTest` reads too — so `/op` on the phone and `/op` on the desktop
 * produce the same bytes, or one of the two tests goes red.
 *
 * Lines rather than method calls, because the two clients reach the socket
 * through differently-shaped objects and the only thing they genuinely share
 * is what comes out of it.
 */
describe('the commands every client has', () => {
  const corpus = JSON.parse(
    readFileSync(join(__dirname, '../fixtures/commands.json'), 'utf8')
  ) as {
    cases: {
      name: string
      input: string
      target: string
      nick: string
      isupport: Record<string, string>
      lines?: string[]
      error?: string
    }[]
  }

  for (const c of corpus.cases) {
    it(c.name, () => {
      const lines: string[] = []
      const wire = {
        connection: {
          send: (...params: string[]) => lines.push(serialise(params)),
          sendRaw: (line: string) => lines.push(line)
        },
        state: {
          isupport: c.isupport as Record<string, string | true>,
          nick: c.nick,
          casemap: (value: string) => value.toLowerCase(),
          channels: new Map()
        },
        // The convenience methods IRCClient offers, as the lines they send
        mode: (target: string, mode: string, ...params: string[]) =>
          lines.push(serialise(['MODE', target, mode, ...params])),
        kick: (channel: string, nick: string, reason?: string) =>
          lines.push(serialise(['KICK', channel, nick, reason ?? nick])),
        join: (channel: string) => lines.push(serialise(['JOIN', channel])),
        part: (channel: string) => lines.push(serialise(['PART', channel]))
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any

      const result = runCommand(wire, c.target, c.input)
      expect(result.handled).toBe(true)

      if (c.error) {
        expect(result.error).toBe(c.error)
        expect(lines).toEqual([])
      } else {
        expect(result.error).toBeUndefined()
        expect(lines).toEqual(c.lines)
      }
    })
  }

  /**
   * The one that would be a memorable bug. Kicking before banning leaves a
   * window in which they can rejoin, which is the single thing kickban exists
   * to prevent.
   */
  it('bans before it kicks, never after', () => {
    const order = corpus.cases.find((c) => c.name === '/kickban bans before it kicks')!
    expect(order.lines![0].startsWith('MODE')).toBe(true)
    expect(order.lines![1].startsWith('KICK')).toBe(true)
  })
})

/**
 * The real serializer, not a second copy of its rules.
 *
 * Which parameters go in the trailing form is exactly the sort of thing the
 * two clients could disagree about, so the comparison has to run through the
 * code that actually decides it.
 */
function serialise(params: string[]): string {
  const [command, ...rest] = params
  return serializeMessage({ command, params: rest })
}
