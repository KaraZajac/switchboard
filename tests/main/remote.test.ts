import { describe, it, expect, vi } from 'vitest'
import {
  encodeFrame,
  FrameDecoder,
  generatePairingCode,
  PROTOCOL_VERSION,
  REMOTE_ALPN
} from '../../src/main/remote/protocol'

// registry.ts registers handlers with ipcMain; the tests only care about the
// allowlist and the sanitiser, so a stub is enough.
vi.mock('electron', () => ({ ipcMain: { handle: () => {} } }))

const { isRemoteAllowed, sanitizeForRemote, sanitizeIncomingFromRemote } =
  await import('../../src/main/ipc/registry')

describe('remote frame codec', () => {
  it('round-trips a frame', () => {
    const decoder = new FrameDecoder()
    const frames = decoder.push(encodeFrame({ t: 'welcome', v: 1, name: 'Switchboard', paired: true }))
    expect(frames).toEqual([{ t: 'welcome', v: 1, name: 'Switchboard', paired: true }])
  })

  it('reassembles a frame split across reads', () => {
    const decoder = new FrameDecoder()
    const bytes = encodeFrame({ t: 'call', id: 7, channel: 'server:list', args: [] })
    expect(decoder.push(bytes.slice(0, 11))).toEqual([])
    expect(decoder.push(bytes.slice(11))).toEqual([
      { t: 'call', id: 7, channel: 'server:list', args: [] }
    ])
  })

  it('yields several frames from one read', () => {
    const decoder = new FrameDecoder()
    const chunk = Uint8Array.from([
      ...encodeFrame({ t: 'event', channel: 'irc:join', data: 1 }),
      ...encodeFrame({ t: 'event', channel: 'irc:names', data: 2 })
    ])
    expect(decoder.push(chunk)).toHaveLength(2)
  })

  it('survives a UTF-8 sequence split mid-character', () => {
    const decoder = new FrameDecoder()
    const bytes = encodeFrame({ t: 'event', channel: 'irc:message', data: 'héllo — ünicode' })
    const split = 12
    decoder.push(bytes.slice(0, split))
    const frames = decoder.push(bytes.slice(split))
    expect(frames).toEqual([{ t: 'event', channel: 'irc:message', data: 'héllo — ünicode' }])
  })

  it('rejects a malformed frame instead of guessing', () => {
    const decoder = new FrameDecoder()
    expect(() => decoder.push(new TextEncoder().encode('not json\n'))).toThrow(/malformed/i)
  })

  it('refuses to buffer without limit', () => {
    const decoder = new FrameDecoder(64)
    expect(() => decoder.push(new TextEncoder().encode('x'.repeat(65)))).toThrow(/size limit/i)
  })

  it('uses a six digit pairing code', () => {
    for (let i = 0; i < 50; i++) {
      expect(generatePairingCode()).toMatch(/^\d{6}$/)
    }
  })

  it('pins the protocol identifiers', () => {
    expect(REMOTE_ALPN).toBe('switchboard/remote/0')
    expect(PROTOCOL_VERSION).toBe(1)
  })
})

describe('what a paired device may reach', () => {
  it('allows the chat surface', () => {
    for (const channel of ['server:list', 'message:send', 'history:fetch', 'channel:join']) {
      expect(isRemoteAllowed(channel)).toBe(true)
    }
  })

  it('keeps the desktop and its files to itself', () => {
    // The line is the desktop as a machine, not the config it happens to hold:
    // a phone may add a network, and may not close a window or read a file off
    // the disk it is talking to.
    for (const channel of [
      'window:close',
      'window:minimize',
      'window:maximize',
      'file:upload',
      'updater:install',
      'updater:check',
      'vault:unlock',
      'remote:revoke'
    ]) {
      expect(isRemoteAllowed(channel)).toBe(false)
    }
  })

  it('lets a device manage the networks it shares', () => {
    for (const channel of ['server:add', 'server:update', 'server:remove', 'settings:set']) {
      expect(isRemoteAllowed(channel)).toBe(true)
    }
  })

  it('lets a device finish registering an account', () => {
    // The verification code arrives by email, which is usually read on a phone
    for (const channel of ['account:register', 'account:verify']) {
      expect(isRemoteAllowed(channel)).toBe(true)
    }
  })

  it('will not let a device erase a password it was never shown', () => {
    // server:list reaches a phone with every secret nulled out. Returning that
    // same object to server:update must not be how a rename wipes the login.
    const [update] = sanitizeIncomingFromRemote('server:update', [
      {
        name: 'Renamed',
        password: null,
        saslPassword: null,
        identifyCommand: null,
        hasPassword: true,
        hasSaslPassword: true
      }
    ]) as Record<string, unknown>[]

    expect(update).not.toHaveProperty('password')
    expect(update).not.toHaveProperty('saslPassword')
    expect(update).not.toHaveProperty('identifyCommand')
    expect(update).not.toHaveProperty('hasPassword')
    expect(update.name).toBe('Renamed')
  })

  it('still lets a device set a password on purpose', () => {
    const [update] = sanitizeIncomingFromRemote('server:update', [
      { saslPassword: 'chosen-on-the-phone' }
    ]) as Record<string, unknown>[]

    expect(update.saslPassword).toBe('chosen-on-the-phone')
  })

  it('leaves a new server its empty secrets', () => {
    // Dropping the key on an insert would leave the column unbound; null there
    // means "no password", which is a real answer rather than a missing one.
    const [added] = sanitizeIncomingFromRemote('server:add', [
      { name: 'New', password: null }
    ]) as Record<string, unknown>[]

    expect(added).toHaveProperty('password')
    expect(added.password).toBeNull()
  })

  it('never sends IRC credentials to a device', () => {
    const servers = [
      {
        id: 'a',
        name: 'Doll',
        host: 'irc.d0ll.link',
        password: 'super-secret-pw',
        saslPassword: 'sasl-secret',
        identifyCommand: '/msg NickServ IDENTIFY hunter2'
      }
    ]

    const sent = sanitizeForRemote('server:list', servers) as Record<string, unknown>[]

    expect(sent[0].password).toBeNull()
    expect(sent[0].saslPassword).toBeNull()
    expect(sent[0].identifyCommand).toBeNull()
    expect(JSON.stringify(sent)).not.toContain('hunter2')
    expect(JSON.stringify(sent)).not.toContain('super-secret-pw')

    // but the phone can still tell that a password is configured
    expect(sent[0].hasPassword).toBe(true)
    expect(sent[0].hasSaslPassword).toBe(true)
    expect(sent[0].host).toBe('irc.d0ll.link')
  })

  it('leaves other results untouched', () => {
    const messages = [{ id: 'm1', content: 'hello' }]
    expect(sanitizeForRemote('history:fetch', messages)).toBe(messages)
  })
})
