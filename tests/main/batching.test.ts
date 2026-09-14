import { describe, it, expect, beforeEach, vi } from 'vitest'
import { EventEmitter } from 'events'
import { parseMessage } from '../../src/main/irc/parser'
import { ConnectionState } from '../../src/main/irc/state'
import { dispatchMessage } from '../../src/main/irc/handlers/registry'
import { checkBatchMembership } from '../../src/main/irc/features/batch'
import { MAX_BATCH_MESSAGES } from '../../src/shared/constants'
import '../../src/main/irc/features/batch'
import '../../src/main/irc/handlers/channel'
import '../../src/main/irc/handlers/registration'
import '../../src/main/irc/handlers/message'

/**
 * Telling history from news.
 *
 * With event-playback a server replays old JOINs, QUITs and NICKs inside the
 * chathistory batch. Handled as live traffic they re-run the whole channel
 * sync — NAMES, metadata, WHO and another CHATHISTORY — whose reply replays
 * the same events again. The client floods itself in a loop it cannot see, and
 * meanwhile removes people who never left.
 */
function client() {
  const state = new ConnectionState()
  state.nick = 'kara'
  const events = new EventEmitter()
  const sent: string[] = []

  return {
    sent,
    events,
    state,
    client: {
      state,
      events,
      connection: {
        send: (...args: string[]) => sent.push(args.join(' ')),
        sendRaw: (line: string) => sent.push(line)
      },
      config: { nick: 'kara', autoJoin: [] }
    } as never
  }
}

/** The client's own routing: buffer if the batch is ours, else dispatch */
function feed(harness: ReturnType<typeof client>, line: string) {
  const msg = parseMessage(line)
  if (checkBatchMembership(harness.client, msg)) return
  dispatchMessage(harness.client, msg)
}

beforeEach(() => vi.restoreAllMocks())

describe('messages inside a batch', () => {
  it('does not act on a JOIN replayed from history', () => {
    const h = client()

    feed(h, ':irc.example.org BATCH +h chathistory #chan')
    h.sent.length = 0
    feed(h, '@batch=h :someone!u@h JOIN #chan')

    // No sync storm — nothing at all was sent in reply to history
    expect(h.sent).toEqual([])
  })

  it('does not remove people on a QUIT replayed from history', () => {
    const h = client()
    feed(h, ':kara!u@h JOIN #chan')
    feed(h, ':irc.example.org 353 kara = #chan :kara stillhere')
    feed(h, ':irc.example.org 366 kara #chan :End of /NAMES list')
    expect(h.state.channels.get('#chan')?.users.has('stillhere')).toBe(true)

    feed(h, ':irc.example.org BATCH +h chathistory #chan')
    feed(h, '@batch=h :stillhere!u@h QUIT :Connection closed')

    // They are still in the channel; that quit was from last week
    expect(h.state.channels.get('#chan')?.users.has('stillhere')).toBe(true)
  })

  it('hands the whole batch over when it closes', () => {
    const h = client()
    const replayed: unknown[] = []
    h.events.on('chathistoryBatch', (data) => replayed.push(data))

    feed(h, ':irc.example.org BATCH +h chathistory #chan')
    feed(h, '@batch=h :a!u@h PRIVMSG #chan :first')
    feed(h, '@batch=h :b!u@h PRIVMSG #chan :second')
    feed(h, ':irc.example.org BATCH -h')

    expect(replayed).toHaveLength(1)
    expect((replayed[0] as { messages: unknown[] }).messages).toHaveLength(2)
    expect((replayed[0] as { target: string }).target).toBe('#chan')
  })

  it('inherits the meaning through a nested batch', () => {
    const h = client()

    feed(h, ':irc.example.org BATCH +outer chathistory #chan')
    feed(h, '@batch=outer :irc.example.org BATCH +inner draft/multiline #chan')
    h.sent.length = 0
    feed(h, '@batch=inner :someone!u@h JOIN #chan')

    // Still history, however deeply nested
    expect(h.sent).toEqual([])
  })

  it('lets a grouping batch through, so NAMES still works', () => {
    const h = client()
    feed(h, ':kara!u@h JOIN #chan')

    // rIRCd and others wrap NAMES in a batch; it is a hint, not a change of
    // meaning, and swallowing it would leave the channel empty
    feed(h, ':irc.example.org BATCH +n names #chan')
    feed(h, '@batch=n :irc.example.org 353 kara = #chan :kara alice bob')
    feed(h, '@batch=n :irc.example.org 366 kara #chan :End of /NAMES list')
    feed(h, ':irc.example.org BATCH -n')

    const users = h.state.channels.get('#chan')?.users
    expect(users?.has('alice')).toBe(true)
    expect(users?.has('bob')).toBe(true)
  })

  it('lets an unknown batch type through untouched', () => {
    const h = client()
    feed(h, ':kara!u@h JOIN #chan')
    feed(h, ':irc.example.org BATCH +x some/future-type #chan')
    feed(h, '@batch=x :irc.example.org 353 kara = #chan :kara carol')
    feed(h, '@batch=x :irc.example.org 366 kara #chan :End of /NAMES list')

    expect(h.state.channels.get('#chan')?.users.has('carol')).toBe(true)
  })

  it('ignores a batch tag for a batch that was never opened', () => {
    const h = client()
    feed(h, ':kara!u@h JOIN #chan')
    feed(h, '@batch=never :irc.example.org 353 kara = #chan :kara dave')
    feed(h, '@batch=never :irc.example.org 366 kara #chan :End of /NAMES list')

    // Unknown reference: process it rather than dropping it on the floor
    expect(h.state.channels.get('#chan')?.users.has('dave')).toBe(true)
  })
})

describe('a batch we pass through', () => {
  it('delivers each message exactly once', () => {
    const h = client()
    feed(h, ':kara!u@h JOIN #chan')

    const names: unknown[] = []
    h.events.on('names', (data) => names.push(data))

    // rIRCd wraps NAMES in a batch. Handled live *and* replayed on close, the
    // 366 fires twice and every follow-up query is sent twice with it.
    feed(h, ':irc.example.org BATCH +n names #chan')
    feed(h, '@batch=n :irc.example.org 353 kara = #chan :kara alice')
    feed(h, '@batch=n :irc.example.org 366 kara #chan :End of /NAMES list')
    feed(h, ':irc.example.org BATCH -n')

    expect(names).toHaveLength(1)
  })

  it('sends one WHO for one end-of-names, not two', () => {
    const h = client()
    h.state.isupport['WHOX'] = true
    feed(h, ':kara!u@h JOIN #chan')
    h.sent.length = 0

    feed(h, ':irc.example.org BATCH +n names #chan')
    feed(h, '@batch=n :irc.example.org 353 kara = #chan :kara alice')
    feed(h, '@batch=n :irc.example.org 366 kara #chan :End of /NAMES list')
    feed(h, ':irc.example.org BATCH -n')

    expect(h.sent.filter((line) => line.startsWith('WHO '))).toHaveLength(1)
  })
})

/**
 * A batch is a promise that an end is coming. A server that opens one and
 * never closes it was this client growing without limit.
 */
describe('a batch that never ends', () => {
  it('is abandoned past the ceiling, and said so', () => {
    const c = client()
    const errors: unknown[] = []
    c.events.on('error', (e: unknown) => errors.push(e))
    dispatchMessage(c, parseMessage(':s BATCH +h chathistory #chan'))
    expect(c.state.batches.has('h')).toBe(true)

    for (let i = 0; i <= MAX_BATCH_MESSAGES; i++) {
      checkBatchMembership(c, parseMessage('@batch=h :n!u@h PRIVMSG #chan :line'))
    }

    expect(c.state.batches.has('h')).toBe(false)
    expect(errors.length).toBe(1)
    // Still consumed after the drop: the overflow must not arrive as live traffic
    expect(checkBatchMembership(c, parseMessage('@batch=h :n!u@h PRIVMSG #chan :late'))).toBe(false)
  })
})

/**
 * A multiline message is one message, and its tags are on the BATCH line.
 *
 * That is where the spec puts msgid, time and account for the whole; the parts
 * carry only `batch`. Built from the first part alone, the message got an
 * invented id — and an edit, a reaction or a REDACT naming the real one found
 * nothing to change, on the desktop and on the phone alike, while the same
 * three actions on a single-line message worked.
 */
describe('a multiline message', () => {
  it('keeps the id, time and account the BATCH line carries', () => {
    const harness = client()
    const seen: Record<string, unknown>[] = []
    harness.events.on('privmsg', (m) => seen.push(m))

    feed(harness, '@msgid=whole;time=2026-09-13T22:06:23.988Z;account=alice :irc.test BATCH +m draft/multiline #chan')
    feed(harness, '@batch=m :alice!u@h PRIVMSG #chan :first line')
    feed(harness, '@batch=m :alice!u@h PRIVMSG #chan :second line')
    feed(harness, ':irc.test BATCH -m')

    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({
      msgid: 'whole',
      time: '2026-09-13T22:06:23.988Z',
      account: 'alice',
      content: 'first line\nsecond line'
    })
  })

  it('lets a part say something the BATCH line did not', () => {
    const harness = client()
    const seen: Record<string, unknown>[] = []
    harness.events.on('privmsg', (m) => seen.push(m))

    feed(harness, '@msgid=whole :irc.test BATCH +m draft/multiline #chan')
    feed(harness, '@batch=m;+reply=earlier :alice!u@h PRIVMSG #chan :one')
    feed(harness, '@batch=m :alice!u@h PRIVMSG #chan :two')
    feed(harness, ':irc.test BATCH -m')

    expect(seen[0]).toMatchObject({ msgid: 'whole', replyTo: 'earlier' })
  })
})
