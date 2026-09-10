import { describe, it, expect, afterEach, vi } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import * as tls from 'tls'

/**
 * Trust the test's own server, and change nothing else.
 *
 * The connection verifies certificates properly and must go on doing so, so
 * the only thing added here is a trust anchor for a server that exists for the
 * length of one test. Everything the code under test decides — including
 * whether to present a certificate at all — it still decides.
 */
let trustAnchor: string | null = null

vi.mock('tls', async (importOriginal) => {
  const real = await importOriginal<typeof import('tls')>()
  return {
    ...real,
    connect: (...args: unknown[]) => {
      const options = args[0] as import('tls').ConnectionOptions
      const anchor = (globalThis as { __switchboardTestCa?: string }).__switchboardTestCa
      return real.connect({ ...options, ...(anchor ? { ca: anchor } : {}) })
    }
  }
})
import { createHash, X509Certificate } from 'crypto'
import { IRCConnection } from '../../src/main/irc/connection'
import type { ServerConfig } from '@shared/types/server'

/**
 * SASL EXTERNAL, which needs the handshake to present a certificate.
 *
 * Both clients implemented the mechanism and the desktop's server dialog has
 * always offered it, and there was nowhere to put a certificate — so the
 * connection presented none, the server had nothing to look up, and choosing
 * it could only ever end in 904. A real handshake against a real TLS server is
 * the only way to know that is fixed: everything short of one passes whether
 * the certificate is sent or not.
 */
const corpus = JSON.parse(
  readFileSync(join(__dirname, '../fixtures/certfp.json'), 'utf8')
) as {
  certificate: string
  privateKey: string
  fingerprint: string
  serverCertificate: string
  serverKey: string
}

const config = (clientCert: string | null): ServerConfig => ({
  id: 'srv',
  name: 'Test',
  host: '127.0.0.1',
  port: 0,
  tls: true,
  password: null,
  nick: 'kara',
  username: 'kara',
  realname: 'Kara',
  saslMechanism: 'EXTERNAL',
  saslUsername: null,
  saslPassword: null,
  autoConnect: false,
  autoJoin: [],
  identifyCommand: null,
  sortOrder: 0,
  websocketUrl: null,
  avatarUrl: null,
  profile: {},
  preAwayMessage: null,
  clientCert
})

let server: tls.Server | null = null

afterEach(() => {
  trustAnchor = null
  delete (globalThis as { __switchboardTestCa?: string }).__switchboardTestCa
  server?.close()
  server = null
})

/**
 * Trust the test's own server, and change nothing else.
 *
 * The connection verifies certificates properly and must go on doing so, so
 * the only thing added here is a trust anchor for a server that exists for the
 * length of one test. Everything the code under test decides — including
 * whether to present a certificate at all — it still decides.
 */
function trustingTheTestServer(): void {
  trustAnchor = corpus.serverCertificate
  ;(globalThis as { __switchboardTestCa?: string }).__switchboardTestCa = trustAnchor
}

/** A TLS server that asks for a certificate and reports what it was given */
function listening(): Promise<{ port: number; presented: Promise<string | null> }> {
  return new Promise((resolve) => {
    let settle: (value: string | null) => void
    const presented = new Promise<string | null>((r) => (settle = r))

    server = tls.createServer(
      {
        cert: corpus.serverCertificate,
        key: corpus.serverKey,
        requestCert: true,
        // The client's certificate is self-signed, which is exactly what a
        // CertFP certificate is: the network identifies it by fingerprint, not
        // by who signed it.
        rejectUnauthorized: false
      },
      (socket) => {
        const peer = socket.getPeerCertificate()
        settle(peer && peer.raw ? createHash('sha256').update(peer.raw).digest('hex') : null)
      }
    )

    server.listen(0, '127.0.0.1', () => {
      resolve({ port: (server!.address() as { port: number }).port, presented })
    })
  })
}

describe('presenting a client certificate', () => {
  it('sends the one that was configured, and the server sees its fingerprint', async () => {
    const { port, presented } = await listening()

    trustingTheTestServer()
    const connection = new IRCConnection({
      ...config(`${corpus.certificate}\n${corpus.privateKey}`),
      host: 'localhost',
      port
    })
    connection.connect()

    expect(await presented).toBe(corpus.fingerprint)
    connection.destroy()
  })

  it('presents nothing when none is configured', async () => {
    const { port, presented } = await listening()

    trustingTheTestServer()
    const connection = new IRCConnection({ ...config(null), host: 'localhost', port })
    connection.connect()

    expect(await presented).toBeNull()
    connection.destroy()
  })

  it('agrees with what the certificate itself says its fingerprint is', () => {
    const parsed = new X509Certificate(corpus.certificate)
    expect(parsed.fingerprint256.replace(/:/g, '').toLowerCase()).toBe(corpus.fingerprint)
  })
})
