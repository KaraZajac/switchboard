import { describe, it, expect, afterEach } from 'vitest'
import * as net from 'net'
import type { ServerConfig } from '../../src/shared/types/server'
import type { ProxySettings } from '../../src/shared/socks'

/**
 * Dialling through a proxy, over real sockets.
 *
 * Mocked sockets would not catch the thing this code actually gets wrong: the
 * handshake is variable-length and arrives in pieces, and the byte after the
 * last reply is already the IRC server talking. A fake socket that delivers
 * every reply in one tidy chunk passes whether or not any of that is handled.
 */

const { IRCConnection, useNetworkSettings } = await import('../../src/main/irc/connection')

const settings: { proxy: ProxySettings | null; caPath: string | null } = { proxy: null, caPath: null }
useNetworkSettings(() => settings)

const servers: net.Server[] = []
afterEach(() => {
  for (const server of servers.splice(0)) server.close()
  settings.proxy = null
  settings.caPath = null
})

function listen(onConnection: (socket: net.Socket) => void): Promise<number> {
  const server = net.createServer(onConnection)
  servers.push(server)
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve((server.address() as net.AddressInfo).port))
  })
}

/** An IRC server that says one line and nothing else */
function ircServer(greeting = ':fake 001 kara :Welcome\r\n'): Promise<number> {
  return listen((socket) => socket.write(greeting))
}

interface ProxyOptions {
  /** Require a username and password before CONNECT */
  password?: { username: string; password: string }
  /** Refuse CONNECT with this SOCKS5 status */
  refuse?: number
  /** Send each reply one byte at a time, as a slow or fragmenting proxy would */
  dribble?: boolean
  /** Answer CONNECT with a hostname-shaped bound address rather than IPv4 */
  boundName?: string
}

/** A SOCKS5 proxy, enough of one to be talked to */
function socks5Proxy(target: () => number, options: ProxyOptions = {}): Promise<number> {
  const asked: { host: string; port: number }[] = []
  ;(socks5Proxy as unknown as { asked: typeof asked }).asked = asked

  return listen((socket) => {
    let stage: 'greeting' | 'auth' | 'connect' = 'greeting'
    let buffer = Buffer.alloc(0)

    const reply = (bytes: Buffer) => {
      if (!options.dribble) return void socket.write(bytes)
      for (const byte of bytes) socket.write(Buffer.from([byte]))
    }

    socket.on('data', (data) => {
      buffer = Buffer.concat([buffer, data])

      if (stage === 'greeting') {
        if (buffer.length < 2) return
        const count = buffer[1]
        if (buffer.length < 2 + count) return
        const methods = Array.from(buffer.subarray(2, 2 + count))
        buffer = buffer.subarray(2 + count)

        if (options.password) {
          if (!methods.includes(0x02)) return void reply(Buffer.from([0x05, 0xff]))
          stage = 'auth'
          return void reply(Buffer.from([0x05, 0x02]))
        }
        stage = 'connect'
        return void reply(Buffer.from([0x05, 0x00]))
      }

      if (stage === 'auth') {
        if (buffer.length < 2) return
        const userLength = buffer[1]
        if (buffer.length < 2 + userLength + 1) return
        const passLength = buffer[2 + userLength]
        if (buffer.length < 3 + userLength + passLength) return

        const user = buffer.subarray(2, 2 + userLength).toString()
        const pass = buffer.subarray(3 + userLength, 3 + userLength + passLength).toString()
        buffer = buffer.subarray(3 + userLength + passLength)

        const ok = user === options.password!.username && pass === options.password!.password
        reply(Buffer.from([0x01, ok ? 0x00 : 0x01]))
        if (!ok) return void socket.end()
        stage = 'connect'
        return
      }

      // connect
      if (buffer.length < 5) return
      const nameLength = buffer[4]
      if (buffer.length < 5 + nameLength + 2) return

      const host = buffer.subarray(5, 5 + nameLength).toString()
      const port = buffer.readUInt16BE(5 + nameLength)
      buffer = buffer.subarray(5 + nameLength + 2)
      asked.push({ host, port })

      if (options.refuse !== undefined) {
        return void reply(Buffer.from([0x05, options.refuse, 0x00, 0x01, 0, 0, 0, 0, 0, 0]))
      }

      const bound = options.boundName
        ? Buffer.concat([
            Buffer.from([0x05, 0x00, 0x00, 0x03, options.boundName.length]),
            Buffer.from(options.boundName),
            Buffer.from([0, 0])
          ])
        : Buffer.from([0x05, 0x00, 0x00, 0x01, 127, 0, 0, 1, 0, 0])
      reply(bound)

      // Now be a wire between the two
      const upstream = net.connect({ host: '127.0.0.1', port: target() }, () => {
        socket.pipe(upstream)
        upstream.pipe(socket)
      })
      upstream.on('error', () => socket.destroy())
    })
  })
}

function config(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    id: 'proxied',
    name: 'Proxied',
    host: 'irc.example.org',
    port: 6667,
    tls: false,
    nick: 'kara',
    username: 'kara',
    realname: 'Kara',
    autoConnect: false,
    autoJoin: [],
    ...overrides
  } as ServerConfig
}

/** The first line the connection parses, or the error that stopped it */
function firstLine(connection: InstanceType<typeof IRCConnection>): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('nothing arrived')), 4000)
    connection.on('raw', (direction, line) => {
      if (direction !== 'in') return
      clearTimeout(timer)
      resolve(line)
    })
    connection.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
  })
}

describe('dialling through a SOCKS5 proxy', () => {
  it('reaches the server and reads its first line', async () => {
    const irc = await ircServer()
    const proxy = await socks5Proxy(() => irc)
    settings.proxy = { type: 'socks5', host: '127.0.0.1', port: proxy }

    const connection = new IRCConnection(config())
    const line = firstLine(connection)
    connection.connect()
    expect(await line).toBe(':fake 001 kara :Welcome')
    connection.disconnect()
  })

  /**
   * The reason a proxy is worth having. Resolving here would announce the
   * destination from this machine, which is what the proxy was there to avoid
   * — and for an onion address there is nothing to resolve.
   */
  it('asks the proxy for the host by name, never an address', async () => {
    const irc = await ircServer()
    const proxy = await socks5Proxy(() => irc)
    settings.proxy = { type: 'socks5', host: '127.0.0.1', port: proxy }

    const connection = new IRCConnection(config({ host: 'irc.example.onion', port: 6667 }))
    const line = firstLine(connection)
    connection.connect()
    await line

    const asked = (socks5Proxy as unknown as { asked: { host: string; port: number }[] }).asked
    expect(asked.at(-1)).toEqual({ host: 'irc.example.onion', port: 6667 })
    connection.disconnect()
  })

  it('authenticates when the proxy asks for a password', async () => {
    const irc = await ircServer()
    const proxy = await socks5Proxy(() => irc, { password: { username: 'kara', password: 'hunter2' } })
    settings.proxy = {
      type: 'socks5',
      host: '127.0.0.1',
      port: proxy,
      username: 'kara',
      password: 'hunter2'
    }

    const connection = new IRCConnection(config())
    const line = firstLine(connection)
    connection.connect()
    expect(await line).toBe(':fake 001 kara :Welcome')
    connection.disconnect()
  })

  it('says so when the password is wrong', async () => {
    const irc = await ircServer()
    const proxy = await socks5Proxy(() => irc, { password: { username: 'kara', password: 'hunter2' } })
    settings.proxy = {
      type: 'socks5',
      host: '127.0.0.1',
      port: proxy,
      username: 'kara',
      password: 'wrong'
    }

    const connection = new IRCConnection(config())
    const line = firstLine(connection)
    connection.connect()
    await expect(line).rejects.toThrow(/refused the username and password/)
    connection.disconnect()
  })

  it('says why the proxy refused', async () => {
    const irc = await ircServer()
    const proxy = await socks5Proxy(() => irc, { refuse: 0x04 })
    settings.proxy = { type: 'socks5', host: '127.0.0.1', port: proxy }

    const connection = new IRCConnection(config())
    const line = firstLine(connection)
    connection.connect()
    await expect(line).rejects.toThrow(/host is unreachable/i)
    connection.disconnect()
  })

  /**
   * A proxy may send its replies in as many packets as it likes, and TCP is
   * free to split them anyway. One byte at a time is the worst case and the
   * one that catches a reader assuming a whole reply per read.
   */
  it('survives a proxy that answers one byte at a time', async () => {
    const irc = await ircServer()
    const proxy = await socks5Proxy(() => irc, { dribble: true })
    settings.proxy = { type: 'socks5', host: '127.0.0.1', port: proxy }

    const connection = new IRCConnection(config())
    const line = firstLine(connection)
    connection.connect()
    expect(await line).toBe(':fake 001 kara :Welcome')
    connection.disconnect()
  })

  /**
   * The bound address decides how long the reply is, and the byte after it is
   * the server's first line. Getting the length wrong eats or corrupts it.
   */
  it('reads a reply whose bound address is a name', async () => {
    const irc = await ircServer()
    const proxy = await socks5Proxy(() => irc, { boundName: 'gateway.example' })
    settings.proxy = { type: 'socks5', host: '127.0.0.1', port: proxy }

    const connection = new IRCConnection(config())
    const line = firstLine(connection)
    connection.connect()
    expect(await line).toBe(':fake 001 kara :Welcome')
    connection.disconnect()
  })

  it('does not go near a proxy when none is set', async () => {
    const irc = await ircServer()
    const connection = new IRCConnection(config({ host: '127.0.0.1', port: irc }))
    const line = firstLine(connection)
    connection.connect()
    expect(await line).toBe(':fake 001 kara :Welcome')
    connection.disconnect()
  })

  it('ignores a half-filled proxy form rather than dialling nothing', async () => {
    const irc = await ircServer()
    settings.proxy = { type: 'socks5', host: '', port: '1080' }

    const connection = new IRCConnection(config({ host: '127.0.0.1', port: irc }))
    const line = firstLine(connection)
    connection.connect()
    expect(await line).toBe(':fake 001 kara :Welcome')
    connection.disconnect()
  })
})
