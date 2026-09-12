import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ServerConfig } from '../../src/shared/types/server'
import { MAX_INCOMING } from '../../src/shared/constants'

const { fakeSockets, FakeSocket } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { EventEmitter } = require('events')

  class FakeSocket extends EventEmitter {
    destroyed = false
    authorized = true
    authorizationError: Error | null = null
    written: string[] = []

    setEncoding(): void {}
    setTimeout(): void {}
    write(chunk: string): boolean {
      this.written.push(chunk)
      return true
    }
    destroy(): void {
      this.destroyed = true
    }
  }

  return { fakeSockets: [] as InstanceType<typeof FakeSocket>[], FakeSocket }
})

function makeSocket() {
  const socket = new FakeSocket()
  fakeSockets.push(socket)
  return socket
}

vi.mock('net', () => ({ connect: () => makeSocket() }))
vi.mock('tls', () => ({ connect: () => makeSocket() }))

const { IRCConnection } = await import('../../src/main/irc/connection')

function config(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    id: 'test',
    name: 'Test',
    host: 'irc.example.org',
    port: 6697,
    tls: true,
    password: null,
    nick: 'tester',
    username: 'tester',
    realname: 'Tester',
    saslMechanism: null,
    saslUsername: null,
    saslPassword: null,
    autoConnect: false,
    autoJoin: [],
    identifyCommand: null,
    sortOrder: 0,
    websocketUrl: null,
    avatarUrl: null,
    preAwayMessage: null,
    ...overrides
  }
}

describe('IRCConnection transport', () => {
  beforeEach(() => {
    fakeSockets.length = 0
  })

  it('signals connected once over TLS, and only after the handshake', () => {
    const connection = new IRCConnection(config({ tls: true }))
    const connected = vi.fn()
    connection.on('connected', connected)

    connection.connect()
    const socket = fakeSockets[fakeSockets.length - 1]

    // TCP is up but the handshake is not done — registration must not start yet.
    socket.emit('connect')
    expect(connected).not.toHaveBeenCalled()

    socket.emit('secureConnect')
    expect(connected).toHaveBeenCalledTimes(1)

    connection.destroy()
  })

  it('signals connected once over plain TCP', () => {
    const connection = new IRCConnection(config({ tls: false, port: 6667 }))
    const connected = vi.fn()
    connection.on('connected', connected)

    connection.connect()
    const socket = fakeSockets[fakeSockets.length - 1]

    socket.emit('connect')
    expect(connected).toHaveBeenCalledTimes(1)

    connection.destroy()
  })

  it('answers server PING with a matching PONG', () => {
    const connection = new IRCConnection(config({ tls: false, port: 6667 }))
    connection.connect()
    const socket = fakeSockets[fakeSockets.length - 1]
    socket.emit('connect')

    // Bytes, not text: the socket has no encoding set, because each line
    // picks its own — see `decodeLine`.
    socket.emit('data', Buffer.from('PING :abc123\r\n'))
    expect(socket.written).toContain('PONG abc123\r\n')

    connection.destroy()
  })

  /**
   * A peer that never sends `\r\n`.
   *
   * Nothing capped the receive buffer, so the answer to "how much will you
   * hold for me?" was "everything you have" — a client anybody can turn off by
   * connecting it to a socket that types and never stops. The phone has had a
   * ceiling since it was written; this is the desktop catching up.
   */
  it('does not grow for ever on a line that never ends', () => {
    const connection = new IRCConnection(config({ tls: false, port: 6667 }))
    connection.connect()
    const socket = fakeSockets[fakeSockets.length - 1]
    socket.emit('connect')

    for (let i = 0; i < 64; i++) socket.emit('data', Buffer.alloc(64 * 1024, 0x41))

    // Reaching in, because the point is the thing nobody can see from outside
    const held = (connection as unknown as { buffer: Buffer }).buffer
    expect(held.length).toBeLessThanOrEqual(MAX_INCOMING)

    connection.destroy()
  })

  /**
   * And what comes after it. Keeping the tail of an over-long line would make
   * its second half the start of the next one, and half a line still parses —
   * which is worse than losing it, because it parses into something nobody
   * sent.
   */
  it('throws away the rest of an over-long line, then carries on', () => {
    const connection = new IRCConnection(config({ tls: false, port: 6667 }))
    const seen: string[] = []
    connection.on('message', (msg) => seen.push(msg.command))
    connection.connect()
    const socket = fakeSockets[fakeSockets.length - 1]
    socket.emit('connect')

    socket.emit('data', Buffer.alloc(MAX_INCOMING + 4096, 0x41))
    socket.emit('data', Buffer.from('PRIVMSG #tail :the rest of it\r\n'))
    socket.emit('data', Buffer.from('NOTICE #next :and a whole one\r\n'))

    // Exactly one line survives. Without the ceiling the run of A's and the
    // PRIVMSG behind it arrive as a single line whose *command* is the run —
    // a message nobody sent, delivered as if somebody had.
    expect(seen).toEqual(['NOTICE'])

    connection.destroy()
  })

  it('reads a line that is not UTF-8 as the text it meant', () => {
    const connection = new IRCConnection(config({ tls: false, port: 6667 }))
    const seen: string[] = []
    connection.on('message', (msg) => seen.push(msg.params[1] ?? ''))
    connection.connect()
    const socket = fakeSockets[fakeSockets.length - 1]
    socket.emit('connect')

    // Latin-1 from a network with no UTF8ONLY to stop it. Decoded strictly as
    // UTF-8 this arrived as a replacement character.
    socket.emit(
      'data',
      Buffer.concat([
        Buffer.from(':n!u@h PRIVMSG #c :caf', 'ascii'),
        Buffer.from([0xe9]),
        Buffer.from('\r\n', 'ascii')
      ])
    )

    expect(seen).toContain('café')
    connection.destroy()
  })

  it('keeps a character that arrived split across two reads', () => {
    const connection = new IRCConnection(config({ tls: false, port: 6667 }))
    const seen: string[] = []
    connection.on('message', (msg) => seen.push(msg.params[1] ?? ''))
    connection.connect()
    const socket = fakeSockets[fakeSockets.length - 1]
    socket.emit('connect')

    // The two bytes of é, in separate packets. Decoding per read rather than
    // per line would have turned this into two replacement characters.
    const line = Buffer.from(':n!u@h PRIVMSG #c :café\r\n', 'utf8')
    const cut = line.indexOf(0xc3) + 1
    socket.emit('data', line.subarray(0, cut))
    socket.emit('data', line.subarray(cut))

    expect(seen).toContain('café')
    connection.destroy()
  })

  it('strips embedded newlines from outgoing lines', () => {
    const connection = new IRCConnection(config({ tls: false, port: 6667 }))
    connection.connect()
    const socket = fakeSockets[fakeSockets.length - 1]
    socket.emit('connect')

    connection.sendRaw('PRIVMSG #chan :hi\r\nQUIT :injected')
    expect(socket.written).toContain('PRIVMSG #chan :hiQUIT :injected\r\n')

    connection.destroy()
  })
})
