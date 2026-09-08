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
