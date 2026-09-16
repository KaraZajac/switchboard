import { describe, it, expect, vi } from 'vitest'
import { parseMessage } from '../../src/main/irc/parser'
import '../../src/main/irc/handlers/index'
import { registeredCommands, dispatchMessage } from '../../src/main/irc/handlers/registry'
import { EventEmitter } from 'events'
import { ConnectionState } from '../../src/main/irc/state'

/** The same shape capability.test.ts builds; that one is file-local */
function createMockClient() {
  const state = new ConnectionState()
  state.nick = 'TestUser'
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { client: { state, events, connection, config } as any, events, state, sentLines }
}

/**
 * Every handled command and numeric, fed lines a hostile server could send:
 * no parameters, one parameter, empty parameters, absurd ones. A handler that
 * throws on any of them is caught by the read loop — but "caught" means that
 * line is dropped and, for some numerics, the state it should have updated is
 * left stale. Nothing here should throw at all.
 */
const shapes = (command: string): string[] => [
  `:s ${command}`,
  `:s ${command} me`,
  `:s ${command} me :`,
  `:s ${command} me * *`,
  `:s ${command} :`,
  `:nick!u@h ${command}`,
  `:nick!u@h ${command} #c`,
  `:nick!u@h ${command} #c :`,
  `${command}`,
  `@time=;msgid= :s ${command} me a b c d e f g h`,
  `:s ${command} me ${'x'.repeat(4000)}`
]

describe('handlers survive malformed input', () => {
  for (const command of registeredCommands()) {
    it(`${command} never throws`, () => {
      const errors: unknown[] = []
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
      try {
        for (const raw of shapes(command)) {
          const { client } = createMockClient()
          client.events.on('error', (e: unknown) => errors.push(e))
          expect(() => dispatchMessage(client, parseMessage(raw)), raw).not.toThrow()
        }
      } finally {
        spy.mockRestore()
      }
    })
  }
})

/**
 * And every numeric nobody registered for.
 *
 * Since refusals started reaching the screen, an unhandled numeric is no
 * longer a line that falls off the end of the dispatcher — it runs code. A
 * thousand of them exist and the client answers about eighty, so this is the
 * path most of what a strange server says now takes.
 */
describe('unclaimed numerics survive malformed input', () => {
  const claimed = new Set(registeredCommands())

  it('never throws, whatever the shape', () => {
    for (let numeric = 0; numeric < 1000; numeric++) {
      const code = String(numeric).padStart(3, '0')
      if (claimed.has(code)) continue

      for (const raw of shapes(code)) {
        const { client } = createMockClient()
        expect(() => dispatchMessage(client, parseMessage(raw)), raw).not.toThrow()
      }
    }
  })

  it('reports the block servers refuse with, and stays quiet elsewhere', () => {
    const reported = new Set<string>()

    for (let numeric = 0; numeric < 1000; numeric++) {
      const code = String(numeric).padStart(3, '0')
      if (claimed.has(code)) continue

      const { client, events } = createMockClient()
      events.on('error', (e: { code: string }) => reported.add(e.code))
      dispatchMessage(client, parseMessage(`:s ${code} me #chan :Something went wrong`))
    }

    for (const code of reported) {
      const numeric = Number(code)
      const refusal = numeric >= 400 && numeric <= 599
      const callerid = numeric >= 716 && numeric <= 718
      expect(refusal || callerid, `${code} was reported`).toBe(true)
    }
    // And the block is covered rather than merely not over-reported
    expect(reported.has('470')).toBe(true)
    expect(reported.has('599')).toBe(true)
    expect(reported.has('716')).toBe(true)
  })

  it('says nothing at all for a numeric with nothing written on it', () => {
    const { client, events } = createMockClient()
    const heard: unknown[] = []
    events.on('error', (e) => heard.push(e))

    dispatchMessage(client, parseMessage(':s 470'))
    dispatchMessage(client, parseMessage(':s 470 me'))

    // `470 me` is a nick and no sentence. It is not a message any server
    // sends, and what it must not do is report the nick back as the news.
    expect(heard).toHaveLength(1)
    expect((heard[0] as { message: string }).message).toBe('me')
  })
})
