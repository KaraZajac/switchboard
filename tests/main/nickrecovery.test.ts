import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { IRCClient, NICK_RECOVERY_INTERVAL_MS } from '../../src/main/irc/client'
import type { ServerConfig } from '@shared/types/server'
import { dispatchMessage } from '../../src/main/irc/handlers/registry'
import '../../src/main/irc/handlers/registration'
import '../../src/main/irc/sasl'
import { parseMessage } from '../../src/main/irc/parser'

/**
 * Getting our own nick back.
 *
 * A device handing over, a netsplit healing, a session still in a ping timeout —
 * all of them leave the user on `kara_`, and all of them clear within a minute.
 * Staying on the fallback nick all evening is the failure worth preventing.
 */

const config = (): ServerConfig => ({
  id: 'srv',
  name: 'Test',
  host: 'irc.example.org',
  port: 6667,
  tls: false,
  password: null,
  nick: 'kara',
  username: 'kara',
  realname: 'Kara',
  saslMechanism: null,
  saslUsername: null,
  saslPassword: null,
  autoConnect: false,
  autoJoin: [],
  identifyCommand: null,
  sortOrder: 0,
  websocketUrl: null,
  avatarUrl: null,
  profile: {},
  preAwayMessage: null
})

/** A client whose socket is a list of the lines it tried to send */
function clientOnPaper() {
  const client = new IRCClient(config())
  const sent: string[] = []
  ;(client.connection as unknown as { send: (...a: string[]) => void }).send = (
    ...args: string[]
  ) => {
    sent.push(args.join(' '))
  }
  return { client, sent }
}

const feed = (client: IRCClient, line: string) => dispatchMessage(client, parseMessage(line))

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('recovering the configured nick', () => {
  it('falls back during registration and keeps asking for the real one', () => {
    const { client, sent } = clientOnPaper()

    feed(client, ':irc.example.org 433 * kara :Nickname is already in use')
    expect(client.state.nick).toBe('kara_')
    expect(sent).toContain('NICK kara_')

    client.state.registrationState = 'connected'
    sent.length = 0
    vi.advanceTimersByTime(NICK_RECOVERY_INTERVAL_MS * 2)

    expect(sent.filter((line) => line === 'NICK kara').length).toBeGreaterThanOrEqual(2)
    client.destroy()
  })

  it('stops the moment the server gives us the nick', () => {
    const { client, sent } = clientOnPaper()
    feed(client, ':irc.example.org 433 * kara :Nickname is already in use')
    client.state.registrationState = 'connected'

    // The other device let go, and the server confirms the change
    feed(client, ':kara_!u@h NICK kara')
    expect(client.state.nick).toBe('kara')

    sent.length = 0
    vi.advanceTimersByTime(NICK_RECOVERY_INTERVAL_MS * 3)
    expect(sent.filter((line) => line.startsWith('NICK'))).toEqual([])
    client.destroy()
  })

  it('does not ask while we are disconnected', () => {
    const { client, sent } = clientOnPaper()
    feed(client, ':irc.example.org 433 * kara :Nickname is already in use')

    // Never registered — asking now would go into a closed socket
    sent.length = 0
    vi.advanceTimersByTime(NICK_RECOVERY_INTERVAL_MS * 3)
    expect(sent).toEqual([])
    client.destroy()
  })

  it('never starts when we already have the nick we wanted', () => {
    const { client, sent } = clientOnPaper()
    client.state.nick = 'kara'
    client.state.registrationState = 'connected'

    client.startNickRecovery()
    vi.advanceTimersByTime(NICK_RECOVERY_INTERVAL_MS * 3)
    expect(sent).toEqual([])
    client.destroy()
  })

  it('gives up its timer when the client is destroyed', () => {
    const { client, sent } = clientOnPaper()
    feed(client, ':irc.example.org 433 * kara :Nickname is already in use')
    client.state.registrationState = 'connected'

    client.destroy()
    sent.length = 0
    vi.advanceTimersByTime(NICK_RECOVERY_INTERVAL_MS * 5)
    expect(sent).toEqual([])
  })
})

/**
 * Recognising our own nick change when the server describes it oddly.
 *
 * The prefix on a NICK is supposed to be the *old* nick, which is how a client
 * knows the change is its own. A server that puts the new one there instead
 * matches nobody, and the client spends the rest of the session convinced it is
 * still called something it is not — its own messages stop looking like its
 * own, and its own name stops highlighting.
 */
describe('following our own nick change', () => {
  it('takes the change when the prefix names our old nick', () => {
    const { client } = clientOnPaper()
    client.state.registrationState = 'connected'
    client.state.nick = 'kara_'
    client.state.desiredNick = 'kara'

    feed(client, ':kara_!kara@host NICK kara')

    expect(client.state.nick).toBe('kara')
    client.destroy()
  })

  it('takes the change when the prefix names the new nick instead', () => {
    const { client, sent } = clientOnPaper()
    client.state.registrationState = 'connected'
    client.state.nick = 'kara_'
    client.state.desiredNick = 'kara'
    client.startNickRecovery()

    vi.advanceTimersByTime(NICK_RECOVERY_INTERVAL_MS)
    expect(sent).toContain('NICK kara')

    // The prefix matches nothing we know; the request we just made does
    feed(client, ':kara!kara@host NICK kara')

    expect(client.state.nick).toBe('kara')
    expect(client.state.pendingNick).toBeNull()
    client.destroy()
  })

  it('does not claim someone else changing to a nick we never asked for', () => {
    const { client } = clientOnPaper()
    client.state.registrationState = 'connected'
    client.state.nick = 'kara_'
    client.state.desiredNick = 'kara'

    feed(client, ':robin!robin@host NICK bunny')

    expect(client.state.nick).toBe('kara_')
    client.destroy()
  })

  /**
   * The race the pending nick has to survive: we ask, we are refused, and then
   * somebody else takes the name. That second NICK is not ours.
   */
  it('forgets what it asked for once the server refuses it', () => {
    const { client } = clientOnPaper()
    client.state.registrationState = 'connected'
    client.state.nick = 'kara_'
    client.setNick('kara')

    expect(client.state.pendingNick).toBe('kara')
    feed(client, ':irc.example.org 433 kara_ kara :Nickname is already in use')
    expect(client.state.pendingNick).toBeNull()

    // Someone else takes it; we are still kara_
    feed(client, ':robin!robin@host NICK kara')
    expect(client.state.nick).toBe('kara_')
    client.destroy()
  })

  it('stops asking once it has the nick it wanted', () => {
    const { client, sent } = clientOnPaper()
    client.state.registrationState = 'connected'
    client.state.nick = 'kara_'
    client.state.desiredNick = 'kara'
    client.startNickRecovery()

    // One tick, so the request is on the wire and can be recognised
    vi.advanceTimersByTime(NICK_RECOVERY_INTERVAL_MS)
    feed(client, ':kara!kara@host NICK kara')
    sent.length = 0
    vi.advanceTimersByTime(NICK_RECOVERY_INTERVAL_MS * 3)

    expect(sent.filter((line) => line.startsWith('NICK'))).toHaveLength(0)
    client.destroy()
  })
})


/**
 * The nick that was refused because we had not authenticated yet.
 *
 * A server that protects registered names refuses one to a connection with no
 * account on it — rIRCd answers 433 "Nickname is registered to another
 * account" — and NICK goes out long before SASL can begin. So for anyone with
 * an account that is the ordinary path, not a corner of one: they arrive as
 * `kara_`, on their own registered name, and nothing says why.
 */
describe('taking back a registered nick once logged in', () => {
  it('asks again the moment SASL succeeds', () => {
    const { client, sent } = clientOnPaper()

    feed(client, ':irc.example.org 433 * kara :Nickname is registered to another account')
    expect(client.state.nick).toBe('kara_')

    sent.length = 0
    feed(client, ':irc.example.org 903 kara_ :SASL authentication successful')

    // Before CAP END, so registration finishes under the right name and
    // auto-join does not join everything as kara_.
    expect(sent.indexOf('NICK kara')).toBeGreaterThanOrEqual(0)
    expect(sent.indexOf('NICK kara')).toBeLessThan(sent.indexOf('CAP END'))
    client.destroy()
  })

  it('says nothing when the nick was never in doubt', () => {
    const { client, sent } = clientOnPaper()
    client.state.nick = 'kara'

    feed(client, ':irc.example.org 903 kara :SASL authentication successful')

    expect(sent.filter((line) => line.startsWith('NICK'))).toEqual([])
    client.destroy()
  })

  /** Being renamed and left to notice is the failure this prevents */
  it('explains the name it settled for, once that is settled', () => {
    const { client } = clientOnPaper()
    const said: string[] = []
    client.events.on('error', (e: { message: string }) => said.push(e.message))

    feed(client, ':irc.example.org 433 * kara :Nickname is registered to another account')
    expect(said, 'nothing is final yet — SASL may still win it back').toEqual([])

    feed(client, ':irc.example.org 001 kara_ :Welcome')

    expect(said).toHaveLength(1)
    expect(said[0]).toContain('kara_')
    expect(said[0]).toContain('kara')
    expect(said[0]).toContain('registered to another account')
    client.destroy()
  })

  it('stays quiet when we got the name we asked for', () => {
    const { client } = clientOnPaper()
    const said: string[] = []
    client.events.on('error', (e: { message: string }) => said.push(e.message))

    feed(client, ':irc.example.org 001 kara :Welcome')

    expect(said).toEqual([])
    client.destroy()
  })
})
