import { describe, it, expect } from 'vitest'
import { requestCapabilities } from '../../src/main/irc/capability'
import { REQUESTED_CAPS } from '@shared/constants'

/**
 * Asking for capabilities without overrunning the line.
 *
 * A CAP REQ that exceeds 512 bytes is answered with 417 ERR_INPUTTOOLONG and
 * registration never completes — the client does not connect at all, and the
 * only clue is a numeric most users never see. The wish list grows over time,
 * so this has to hold as it does.
 */
function recorder() {
  const sent: string[] = []
  return {
    sent,
    client: {
      connection: {
        send: (...args: string[]) => {
          // Mirror the serializer: the cap list is the trailing parameter
          sent.push(`${args[0]} ${args[1]} :${args.slice(2).join(' ')}`)
        }
      },
      state: { pendingCapRequests: 0 }
    }
  }
}

const LIMIT = 512

describe('splitting CAP REQ', () => {
  it('sends one line when it fits', () => {
    const { client, sent } = recorder()
    requestCapabilities(client, ['sasl', 'server-time', 'batch'])

    expect(sent).toEqual(['CAP REQ :sasl server-time batch'])
    expect(client.state.pendingCapRequests).toBe(1)
  })

  it('keeps every line inside the limit', () => {
    const { client, sent } = recorder()
    const many = Array.from({ length: 60 }, (_, i) => `draft/capability-number-${i}`)

    requestCapabilities(client, many)

    expect(sent.length).toBeGreaterThan(1)
    for (const line of sent) {
      expect(Buffer.byteLength(line) + 2, line).toBeLessThanOrEqual(LIMIT)
    }
  })

  it('asks for everything, exactly once, in order', () => {
    const { client, sent } = recorder()
    const many = Array.from({ length: 60 }, (_, i) => `draft/capability-number-${i}`)

    requestCapabilities(client, many)

    const asked = sent.flatMap((line) => line.replace('CAP REQ :', '').split(' '))
    expect(asked).toEqual(many)
  })

  it('counts the lines, so CAP END waits for the last answer', () => {
    const { client, sent } = recorder()
    requestCapabilities(client, Array.from({ length: 60 }, (_, i) => `cap-${i}-with-a-long-name`))
    expect(client.state.pendingCapRequests).toBe(sent.length)
  })

  it('does not split a single capability that is somehow enormous', () => {
    const { client, sent } = recorder()
    requestCapabilities(client, ['x'.repeat(600)])
    expect(sent).toHaveLength(1)
  })

  it("the real wish list fits, however long it has grown", () => {
    const { client, sent } = recorder()
    requestCapabilities(client, [...REQUESTED_CAPS])

    for (const line of sent) {
      expect(Buffer.byteLength(line) + 2, line).toBeLessThanOrEqual(LIMIT)
    }
    const asked = sent.flatMap((line) => line.replace('CAP REQ :', '').split(' '))
    expect(new Set(asked)).toEqual(new Set(REQUESTED_CAPS))
  })
})

/**
 * It is the answer that has to fit.
 *
 * The server repeats the list behind `:its.name CAP * ACK :`, which is longer
 * than `CAP REQ :` by the server's name and then some. rIRCd, which offers
 * more capabilities than most, answered a 504-byte request with a 512-byte
 * ACK cut off in the middle of a capability name — and the one that was cut
 * was simply never enabled, with nothing anywhere to say so.
 */
describe('leaving room for the answer', () => {
  const ackFor = (line: string, server: string, nick: string) =>
    `:${server} CAP ${nick} ACK :${line.replace('CAP REQ :', '')}`
  const many = Array.from({ length: 60 }, (_, i) => `draft/capability-number-${i}`)

  it("keeps the server's ACK inside the limit too", () => {
    const { client, sent } = recorder()
    const server = 'a-server-with-a-long-name.example-network.org'
    requestCapabilities(client, many, { server, nick: '*' })

    expect(sent.length).toBeGreaterThan(1)
    for (const line of sent) {
      const ack = ackFor(line, server, '*')
      expect(Buffer.byteLength(ack) + 2, ack).toBeLessThanOrEqual(LIMIT)
    }
  })

  it('budgets for the nick where the server already uses it in the reply', () => {
    const { client, sent } = recorder()
    const nick = 'somebody-with-a-thirty-char-nick'
    requestCapabilities(client, many, { server: 'irc.example.org', nick })

    for (const line of sent) {
      const ack = ackFor(line, 'irc.example.org', nick)
      expect(Buffer.byteLength(ack) + 2, ack).toBeLessThanOrEqual(LIMIT)
    }
  })

  it('assumes a long server name when it has not heard one', () => {
    const { client, sent } = recorder()
    requestCapabilities(client, many)

    const longest = 'x'.repeat(63)
    for (const line of sent) {
      const ack = ackFor(line, longest, '*')
      expect(Buffer.byteLength(ack) + 2, ack).toBeLessThanOrEqual(LIMIT)
    }
  })

  it('still asks for everything, exactly once, in order', () => {
    const { client, sent } = recorder()
    requestCapabilities(client, many, { server: 'irc.smoke.test', nick: '*' })

    const asked = sent.flatMap((line) => line.replace('CAP REQ :', '').split(' '))
    expect(asked).toEqual(many)
    expect(client.state.pendingCapRequests).toBe(sent.length)
  })

  it("the real wish list, answered by a server that offers it all", () => {
    const { client, sent } = recorder()
    const server = 'irc.smoke.test'
    requestCapabilities(client, [...REQUESTED_CAPS], { server, nick: '*' })

    for (const line of sent) {
      const ack = ackFor(line, server, '*')
      expect(Buffer.byteLength(ack) + 2, ack).toBeLessThanOrEqual(LIMIT)
    }
  })
})
