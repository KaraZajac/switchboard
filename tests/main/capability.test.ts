import { describe, it, expect, beforeEach, vi } from 'vitest'
import { EventEmitter } from 'events'
import { parseMessage } from '../../src/main/irc/parser'
import { dispatchMessage } from '../../src/main/irc/handlers/registry'
import { ConnectionState } from '../../src/main/irc/state'

// Import handler modules to register them
import '../../src/main/irc/handlers/registration'
import '../../src/main/irc/handlers/channel'
import '../../src/main/irc/handlers/message'
import '../../src/main/irc/handlers/user'
import '../../src/main/irc/handlers/error'
import '../../src/main/irc/capability'
import '../../src/main/irc/sasl'

function createMockClient() {
  const state = new ConnectionState()
  state.nick = 'TestUser'
  state.capNegotiating = true

  const events = new EventEmitter()
  const sentLines: string[] = []
  const connection = {
    send: (...args: string[]) => sentLines.push(args.join(' ')),
    sendRaw: (line: string) => sentLines.push(line)
  }

  const config = {
    nick: 'TestUser',
    autoJoin: [],
    saslMechanism: null,
    saslUsername: null,
    saslPassword: null,
    password: null
  }

  return {
    client: { state, events, connection, config } as any,
    events,
    state,
    sentLines
  }
}

describe('CAP Negotiation', () => {
  it('parses CAP LS and requests known caps', () => {
    const { client, sentLines } = createMockClient()

    dispatchMessage(
      client,
      parseMessage(':server CAP * LS :multi-prefix sasl message-tags server-time echo-message')
    )

    // Should have sent a CAP REQ for the known caps
    const reqLine = sentLines.find((l) => l.startsWith('CAP REQ'))
    expect(reqLine).toBeDefined()
    expect(reqLine).toContain('multi-prefix')
    expect(reqLine).toContain('sasl')
    expect(reqLine).toContain('message-tags')
    expect(reqLine).toContain('server-time')
    expect(reqLine).toContain('echo-message')
  })

  it('handles CAP LS with values', () => {
    const { client, state } = createMockClient()

    dispatchMessage(client, parseMessage(':server CAP * LS :sasl=PLAIN,EXTERNAL multi-prefix'))

    expect(state.availableCapabilities.get('sasl')).toBe('PLAIN,EXTERNAL')
    expect(state.availableCapabilities.get('multi-prefix')).toBeNull()
  })

  it('handles multi-line CAP LS', () => {
    const { client, sentLines } = createMockClient()

    // First line with * continuation marker
    dispatchMessage(client, parseMessage(':server CAP * LS * :multi-prefix sasl message-tags'))

    // Should NOT have sent REQ yet
    expect(sentLines.filter((l) => l.startsWith('CAP REQ')).length).toBe(0)

    // Second (final) line
    dispatchMessage(client, parseMessage(':server CAP * LS :server-time echo-message'))

    // NOW it should request
    const reqLine = sentLines.find((l) => l.startsWith('CAP REQ'))
    expect(reqLine).toBeDefined()
  })

  it('handles CAP ACK and sends CAP END (no SASL)', () => {
    const { client, sentLines, state } = createMockClient()

    dispatchMessage(
      client,
      parseMessage(':server CAP * ACK :multi-prefix message-tags server-time')
    )

    expect(state.capabilities.has('multi-prefix')).toBe(true)
    expect(state.capabilities.has('message-tags')).toBe(true)
    expect(state.capabilities.has('server-time')).toBe(true)
    expect(sentLines).toContain('CAP END')
    expect(state.capNegotiating).toBe(false)
  })

  it('handles CAP ACK with SASL — does NOT send CAP END yet', () => {
    const { client, sentLines, state } = createMockClient()
    client.config.saslMechanism = 'PLAIN'

    dispatchMessage(client, parseMessage(':server CAP * ACK :sasl multi-prefix'))

    expect(state.capabilities.has('sasl')).toBe(true)
    expect(sentLines).not.toContain('CAP END')
    // CAP END should be sent after SASL completes
  })

  it('handles CAP NAK — sends CAP END', () => {
    const { client, sentLines, state } = createMockClient()

    dispatchMessage(client, parseMessage(':server CAP * NAK :some-unknown-cap'))

    expect(sentLines).toContain('CAP END')
    expect(state.capNegotiating).toBe(false)
  })

  it('handles CAP NEW — requests new known caps', () => {
    const { client, sentLines } = createMockClient()

    dispatchMessage(client, parseMessage(':server CAP * NEW :away-notify account-notify'))

    const reqLine = sentLines.find((l) => l.startsWith('CAP REQ'))
    expect(reqLine).toBeDefined()
    expect(reqLine).toContain('away-notify')
    expect(reqLine).toContain('account-notify')
  })

  it('handles CAP DEL — removes caps from state', () => {
    const { client, state } = createMockClient()
    state.capabilities.add('away-notify')
    state.availableCapabilities.set('away-notify', null)

    dispatchMessage(client, parseMessage(':server CAP * DEL :away-notify'))

    expect(state.capabilities.has('away-notify')).toBe(false)
    expect(state.availableCapabilities.has('away-notify')).toBe(false)
  })

  it('sends CAP END with no requestable caps', () => {
    const { client, sentLines, state } = createMockClient()

    dispatchMessage(client, parseMessage(':server CAP * LS :some-unknown-cap another-unknown'))

    expect(sentLines).toContain('CAP END')
    expect(state.capNegotiating).toBe(false)
  })
})

describe('SASL Authentication', () => {
  it('handles SASL PLAIN authentication flow', () => {
    const { client, sentLines } = createMockClient()
    client.config.saslMechanism = 'PLAIN'
    client.config.saslUsername = 'myuser'
    client.config.saslPassword = 'mypass'

    // Server says ready
    dispatchMessage(client, parseMessage('AUTHENTICATE +'))

    // Should have sent base64-encoded credentials
    const authLine = sentLines.find((l) => l.startsWith('AUTHENTICATE') && l !== 'AUTHENTICATE +')
    expect(authLine).toBeDefined()

    // Decode and verify format: \0username\0password
    const encoded = authLine!.split(' ')[1]
    const decoded = Buffer.from(encoded, 'base64').toString('utf8')
    expect(decoded).toBe('\0myuser\0mypass')
  })

  /**
   * A password that is stored and cannot be read back is not a password.
   *
   * `decryptSecret` answers null both for "nothing saved" and for "saved under
   * a key this machine no longer has" — a moved profile, a reset keyring. The
   * second used to authenticate with an empty string, the server refused it,
   * and the banner said "SASL authentication failed": the server blamed for
   * turning down a password it was never sent, and no hint that the fix is to
   * type it again.
   */
  it('refuses to authenticate with a password it could not read', () => {
    const { client, sentLines } = createMockClient()
    client.config.saslMechanism = 'PLAIN'
    client.config.saslUsername = 'myuser'
    client.config.saslPassword = null
    client.config.unreadableSecrets = ['saslPassword']

    const errors: { message: string }[] = []
    client.events.on('error', (err: { message: string }) => errors.push(err))

    dispatchMessage(client, parseMessage('AUTHENTICATE +'))

    // Nothing that could be mistaken for an attempt
    const attempted = sentLines.filter(
      (l) => l.startsWith('AUTHENTICATE') && l !== 'AUTHENTICATE *'
    )
    expect(attempted).toEqual([])

    // The exchange is abandoned the way the spec says, and registration is
    // let go of — without CAP END the connection waits for ever.
    expect(sentLines).toContain('AUTHENTICATE *')
    expect(sentLines).toContain('CAP END')
    expect(client.state.capNegotiating).toBe(false)

    // And the message names the fix rather than the symptom
    expect(errors).toHaveLength(1)
    expect(errors[0].message).toMatch(/could not be read/i)
    expect(errors[0].message).toMatch(/enter it again/i)
  })

  /** A password that is simply absent is a different thing, and still tried */
  it('still authenticates when there is no password saved at all', () => {
    const { client, sentLines } = createMockClient()
    client.config.saslMechanism = 'PLAIN'
    client.config.saslUsername = 'myuser'
    client.config.saslPassword = null

    dispatchMessage(client, parseMessage('AUTHENTICATE +'))

    const authLine = sentLines.find((l) => l.startsWith('AUTHENTICATE') && l !== 'AUTHENTICATE +')
    expect(authLine).toBeDefined()
    expect(sentLines).not.toContain('AUTHENTICATE *')
  })

  it('handles SASL EXTERNAL — sends empty auth', () => {
    const { client, sentLines } = createMockClient()
    client.config.saslMechanism = 'EXTERNAL'

    dispatchMessage(client, parseMessage('AUTHENTICATE +'))

    expect(sentLines).toContain('AUTHENTICATE +')
  })

  it('sends CAP END on SASL success (903)', () => {
    const { client, sentLines, state } = createMockClient()

    dispatchMessage(client, parseMessage(':server 903 TestUser :SASL authentication successful'))

    expect(sentLines).toContain('CAP END')
    expect(state.capNegotiating).toBe(false)
  })

  it('sends CAP END on SASL failure (904)', () => {
    const { client, sentLines, state, events } = createMockClient()
    const handler = vi.fn()
    events.on('error', handler)

    dispatchMessage(client, parseMessage(':server 904 TestUser :SASL authentication failed'))

    expect(sentLines).toContain('CAP END')
    expect(state.capNegotiating).toBe(false)
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        code: '904'
      })
    )
  })
})
