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
