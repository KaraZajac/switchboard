import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ServerConfig } from '../../src/shared/types/server'

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

    socket.emit('data', 'PING :abc123\r\n')
    expect(socket.written).toContain('PONG abc123\r\n')

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
