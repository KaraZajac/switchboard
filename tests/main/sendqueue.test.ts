import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  IRCConnection,
  SEND_BURST,
  SEND_RATE_PER_SECOND
} from '../../src/main/irc/connection'
import type { ServerConfig } from '@shared/types/server'

/**
 * Pacing what we send.
 *
 * Every ircd has a send-queue limit and enforces it by dropping commands or
 * killing the connection. Connecting is when a client wants to say the most at
 * once — subscribe, publish a profile, join, ask for history and names — so it
 * is exactly when an unpaced client loses commands it will never notice losing.
 */

const config = (): ServerConfig => ({
  id: 'srv',
  name: 'Test',
  host: '127.0.0.1',
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

/** A connection whose socket is a list of the lines that reached the wire */
function connectionOnPaper() {
  const connection = new IRCConnection(config())
  const written: string[] = []

  ;(connection as unknown as { socket: unknown }).socket = {
    destroyed: false,
    write: (line: string) => {
      written.push(line.replace(/\r\n$/, ''))
      return true
    },
    removeAllListeners: () => {},
    destroy: () => {},
    end: () => {}
  }

  return { connection, written }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('the send queue', () => {
  it('lets a short burst straight through', () => {
    const { connection, written } = connectionOnPaper()

    for (let i = 0; i < SEND_BURST; i++) connection.send('JOIN', `#c${i}`)

    expect(written).toHaveLength(SEND_BURST)
  })

  it('holds back the rest instead of dropping it', () => {
    const { connection, written } = connectionOnPaper()

    const total = SEND_BURST + 4
    for (let i = 0; i < total; i++) connection.send('JOIN', `#c${i}`)

    expect(written).toHaveLength(SEND_BURST)

    // Everything arrives, in order, at the sustained rate
    vi.advanceTimersByTime((4 / SEND_RATE_PER_SECOND) * 1000 + 100)
    expect(written).toHaveLength(total)
    expect(written[total - 1]).toBe(`JOIN #c${total - 1}`)
  })

  it('keeps the order it was given', () => {
    const { connection, written } = connectionOnPaper()

    for (let i = 0; i < SEND_BURST + 5; i++) connection.send('PRIVMSG', '#c', `line ${i}`)
    vi.advanceTimersByTime(10_000)

    expect(written.map((line) => line.split(':').pop())).toEqual(
      Array.from({ length: SEND_BURST + 5 }, (_, i) => `line ${i}`)
    )
  })

  it('answers a PING immediately, however long the queue', () => {
    const { connection, written } = connectionOnPaper()

    // Spend the whole bucket first
    for (let i = 0; i < SEND_BURST + 3; i++) connection.send('JOIN', `#c${i}`)
    written.length = 0

    // A ping arriving now must be answered at once, or we are pinged out. It
    // belongs to no sequence, so overtaking costs nothing.
    connection.send('PONG', 'irc.example.org')
    expect(written).toEqual(['PONG irc.example.org'])
  })

  it('sends registration straight out, because nothing is waiting yet', () => {
    const { connection, written } = connectionOnPaper()

    connection.send('CAP', 'LS', '302')
    connection.send('NICK', 'kara')
    connection.send('USER', 'kara', '0', '*', 'Kara')

    expect(written).toEqual(['CAP LS 302', 'NICK kara', 'USER kara 0 * :Kara'])
  })

  it('does not let an exempt command overtake a queue', () => {
    const { connection, written } = connectionOnPaper()

    // A multiline batch is a sequence; a NICK landing inside it is a bug
    // nobody can reproduce.
    connection.sendRaw('BATCH +ml1 draft/multiline #chan')
    for (let i = 0; i < SEND_BURST + 2; i++) {
      connection.sendRaw(`@batch=ml1 PRIVMSG #chan :line ${i}`)
    }
    connection.send('NICK', 'kara2')
    connection.sendRaw('BATCH -ml1')

    vi.advanceTimersByTime(30_000)

    const nickAt = written.indexOf('NICK kara2')
    const batchEndAt = written.indexOf('BATCH -ml1')
    expect(nickAt).toBeGreaterThan(written.indexOf('@batch=ml1 PRIVMSG #chan :line 0'))
    expect(batchEndAt).toBeGreaterThan(nickAt)
    // Every line of the batch precedes the nick change
    expect(written.slice(0, nickAt).filter((l) => l.startsWith('@batch=ml1'))).toHaveLength(
      SEND_BURST + 2
    )
  })

  it('recognises the command even behind tags and a prefix', () => {
    const { connection, written } = connectionOnPaper()
    for (let i = 0; i < SEND_BURST + 2; i++) connection.send('JOIN', `#c${i}`)
    written.length = 0

    connection.sendRaw('@label=1 PONG irc.example.org')
    expect(written).toEqual(['@label=1 PONG irc.example.org'])
  })

  it('refills over time, so a quiet client can burst again', () => {
    const { connection, written } = connectionOnPaper()

    for (let i = 0; i < SEND_BURST; i++) connection.send('JOIN', `#a${i}`)
    expect(written).toHaveLength(SEND_BURST)

    vi.advanceTimersByTime((SEND_BURST / SEND_RATE_PER_SECOND) * 1000 + 100)
    written.length = 0

    for (let i = 0; i < SEND_BURST; i++) connection.send('JOIN', `#b${i}`)
    expect(written).toHaveLength(SEND_BURST)
  })

  it('drops what is queued when the connection goes away', () => {
    const { connection, written } = connectionOnPaper()

    for (let i = 0; i < SEND_BURST + 5; i++) connection.send('JOIN', `#c${i}`)
    const sentBeforeClose = written.length

    connection.destroy()
    vi.advanceTimersByTime(30_000)

    // Nothing more reached a socket that is no longer there
    expect(written).toHaveLength(sentBeforeClose)
  })

  it('still strips embedded newlines, queued or not', () => {
    const { connection, written } = connectionOnPaper()

    connection.sendRaw('PRIVMSG #c :hello\r\nQUIT :injected')
    expect(written[0]).toBe('PRIVMSG #c :helloQUIT :injected')
  })
})

describe('the websocket transport', () => {
  it('offers the subprotocols the spec defines', async () => {
    const { WEBSOCKET_SUBPROTOCOLS } = await import('../../src/main/irc/connection')

    // A conformant server refuses anything else, so a wrong name here does not
    // degrade the transport — it removes it
    expect(WEBSOCKET_SUBPROTOCOLS).toEqual(['text.ircv3.net', 'binary.ircv3.net'])
    expect(WEBSOCKET_SUBPROTOCOLS).not.toContain('irc')
  })
})
