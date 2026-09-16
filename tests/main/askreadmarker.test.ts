import { describe, it, expect } from 'vitest'
import { EventEmitter } from 'events'
import { parseMessage } from '../../src/main/irc/parser'
import { ConnectionState } from '../../src/main/irc/state'
import { dispatchMessage } from '../../src/main/irc/handlers/registry'
import '../../src/main/irc/handlers/index'

/**
 * Asking where a conversation was read up to.
 *
 * A device only ever hears a marker it was present for. Open the desktop after
 * a week and `CHATHISTORY TARGETS` tells it about every conversation that had
 * traffic — and about where any of them was read up to, nothing at all. So a
 * DM answered on the phone on Tuesday turned up here on Friday with its badge
 * lit, which is half of "old DMs coming up with badges of unread".
 *
 * `MARKREAD <target>` with no timestamp is the question. rIRCd answers
 * `MARKREAD <target> *` where it holds no position, which was read off the
 * wire before this was written.
 */
function client(...capabilities: string[]) {
  const state = new ConnectionState()
  state.nick = 'kara'
  for (const cap of capabilities) state.capabilities.add(cap)

  const sent: string[] = []
  return {
    sent,
    client: {
      state,
      events: new EventEmitter(),
      connection: { send: (...args: string[]) => sent.push(args.join(' ')) },
      config: { nick: 'kara', autoJoin: [] }
    } as never
  }
}

describe('a conversation we have just heard about', () => {
  it('is asked about', () => {
    const { client: c, sent } = client('draft/read-marker', 'draft/chathistory')

    dispatchMessage(c, parseMessage(':server CHATHISTORY TARGETS alice 2026-09-16T09:00:00.000Z'))

    expect(sent).toContain('MARKREAD alice')
  })

  it('and so is a channel we join', () => {
    const { client: c, sent } = client('draft/read-marker')

    dispatchMessage(c, parseMessage(':kara!u@h JOIN #chan'))

    expect(sent).toContain('MARKREAD #chan')
  })

  it('but not a channel somebody else joins', () => {
    const { client: c, sent } = client('draft/read-marker')

    dispatchMessage(c, parseMessage(':kara!u@h JOIN #chan'))
    sent.length = 0
    dispatchMessage(c, parseMessage(':alice!u@h JOIN #chan'))

    expect(sent).not.toContain('MARKREAD #chan')
  })

  it('and nothing is asked on a network that does not keep the answer', () => {
    const { client: c, sent } = client('draft/chathistory')

    dispatchMessage(c, parseMessage(':server CHATHISTORY TARGETS alice 2026-09-16T09:00:00.000Z'))
    dispatchMessage(c, parseMessage(':kara!u@h JOIN #chan'))

    expect(sent.filter((line) => line.startsWith('MARKREAD'))).toEqual([])
  })
})

describe('what comes back', () => {
  const heard = (line: string) => {
    const { client: c } = client('draft/read-marker')
    const markers: { channel: string; timestamp: string }[] = []
    ;(c as unknown as { events: EventEmitter }).events.on('readMarker', (m) => markers.push(m))
    dispatchMessage(c, parseMessage(line))
    return markers
  }

  it('is a position when the server holds one', () => {
    expect(heard(':server MARKREAD #chan timestamp=2026-09-16T09:00:00.000Z')).toEqual([
      { channel: '#chan', timestamp: '2026-09-16T09:00:00.000Z' }
    ])
  })

  it('and nothing at all when it does not', () => {
    // `*` is how a server says it holds none. Read as a position it sorts
    // above every real timestamp and marks the whole conversation read.
    expect(heard(':server MARKREAD #chan *')).toEqual([])
    // The bare form is what the spec gives; this one is not, and means the same
    expect(heard(':server MARKREAD #chan timestamp=*')).toEqual([])
  })
})
