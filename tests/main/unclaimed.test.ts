import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'events'
import { parseMessage } from '../../src/main/irc/parser'
import { dispatchMessage, registeredCommands } from '../../src/main/irc/handlers/registry'
import { IRCClient } from '../../src/main/irc/client'
import type { ServerConfig } from '@shared/types/server'

// Every handler, so that "nothing claimed this" means it in the real client
import '../../src/main/irc/handlers/index'

/**
 * What the user is told when the server refuses and nothing was listening.
 *
 * The client answers around a hundred commands and numerics, which sounds like
 * a lot until you count what a server can say: every network has its own
 * refusals, and the ones that matter are exactly the ones a client was never
 * written for. Before this they went into the dispatcher and stopped there —
 * the user did something, the server said no, and the screen did not change.
 *
 * These are all real lines from servers Switchboard connects to.
 */
function listening() {
  const events = new EventEmitter()
  const errors: { code: string; message: string }[] = []
  events.on('error', (data) => errors.push(data))
  return { client: { events } as never, errors }
}

function say(line: string): { code: string; message: string }[] {
  const { client, errors } = listening()
  dispatchMessage(client, parseMessage(line))
  return errors
}

describe('a refusal nothing was listening for', () => {
  it('says why a message to somebody blocking strangers went nowhere', () => {
    // rIRCd advertises CALLERID=g, so this is a line from Kara's own network
    expect(say(':irc.netslum.io 716 kara bob :is in +g mode (server-side ignore)')).toEqual([
      { code: '716', command: '', message: 'bob is in +g mode (server-side ignore)' }
    ])
  })

  it('says the room you asked for sent you somewhere else', () => {
    expect(say(':ergo.test 470 kara #linux #linux-overflow :Forwarding to another channel'))
      .toEqual([
        {
          code: '470',
          command: '',
          message: '#linux #linux-overflow: Forwarding to another channel'
        }
      ])
  })

  it('says the server password was wrong, which otherwise just closes the socket', () => {
    expect(say(':server 464 * :Password incorrect')).toEqual([
      { code: '464', command: '', message: 'Password incorrect' }
    ])
  })

  it('says you are banned from the server, which looks like the network being down', () => {
    expect(say(':server 465 kara :You are banned from this server: flooding')).toEqual([
      { code: '465', command: '', message: 'You are banned from this server: flooding' }
    ])
  })

  it('says the command needed an operator', () => {
    expect(say(":server 481 kara :Permission Denied- You're not an IRC operator")).toEqual([
      { code: '481', command: '', message: "Permission Denied- You're not an IRC operator" }
    ])
  })
})

describe('and a reply that is data rather than news', () => {
  it('stays out of the way', () => {
    // 671 is a whois line. There are hundreds like it, and a client that
    // announced every one it had no handler for would be unusable.
    expect(say(':server 671 kara bob :is using a secure connection')).toEqual([])
  })

  it('leaves alone the numerics that do have handlers', () => {
    // 433 emits its own event with its own meaning; the fallback must not
    // reach it, or the nick-in-use flow gets a second, dumber report
    const { client, errors } = listening()
    const claimed = vi.fn()
    ;(client as unknown as { events: EventEmitter }).events.on('nickInUse', claimed)

    dispatchMessage(
      { ...(client as object), state: { nick: 'kara' }, config: {}, connection: { send: () => {} } } as never,
      parseMessage(':server 433 * kara :Nickname is already in use')
    )

    expect(errors.map((e) => e.code)).not.toContain('433')
  })
})

describe('the handler set itself', () => {
  it('has not quietly grown a handler for the numerics tested here', () => {
    // If one of these gains a real handler the fallback stops firing for it,
    // and the test above would start failing for a reason that is good news.
    // Named here so the next person knows which way round that is.
    const claimed = new Set(registeredCommands())
    for (const numeric of ['464', '465', '470', '481', '716']) {
      expect(claimed.has(numeric), `${numeric} now has a handler of its own`).toBe(false)
    }
  })
})

/**
 * And the emitter it all goes out on.
 *
 * Node treats `error` as special: emitting one with nothing listening throws
 * rather than returning false. This runs inside the socket's read loop, so a
 * throw there takes the connection with it — and `destroy` removes every
 * listener while lines can still be in flight, which is not a hypothetical
 * window but the ordinary one when a network is dropped or handed to another
 * device.
 *
 * Found by feeding every numeric a server could send through the dispatcher
 * with nothing attached to it.
 */
describe('a refusal arriving with nobody listening', () => {
  const config = (): ServerConfig => ({
    id: 'srv', name: 'Test', host: 'irc.example.org', port: 6667, tls: false,
    password: null, nick: 'kara', username: 'kara', realname: 'Kara',
    saslMechanism: null, saslUsername: null, saslPassword: null,
    autoConnect: false, autoJoin: [], identifyCommand: null, sortOrder: 0,
    websocketUrl: null, avatarUrl: null, profile: {}, preAwayMessage: null
  })

  it('does not take the client down on a fresh one', () => {
    const client = new IRCClient(config())
    expect(() =>
      dispatchMessage(client, parseMessage(':s 481 kara :Permission Denied'))
    ).not.toThrow()
    client.destroy()
  })

  it('nor on one that has been destroyed under it', () => {
    const client = new IRCClient(config())
    client.events.on('error', () => {})
    client.destroy()

    expect(() =>
      dispatchMessage(client, parseMessage(':s 481 kara :Permission Denied'))
    ).not.toThrow()
  })

  it('nor on an emitter that was never a client at all', () => {
    const bare = { events: new EventEmitter() }
    expect(() =>
      dispatchMessage(bare as never, parseMessage(':s 481 kara :Permission Denied'))
    ).not.toThrow()
  })
})
