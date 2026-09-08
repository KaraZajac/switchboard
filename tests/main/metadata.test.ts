import { describe, it, expect, beforeEach } from 'vitest'
import { EventEmitter } from 'events'
import { parseMessage } from '../../src/main/irc/parser'
import { ConnectionState } from '../../src/main/irc/state'
import { dispatchMessage } from '../../src/main/irc/handlers/registry'
import { expectCleared } from '../../src/main/irc/features/metadata'
import '../../src/main/irc/features/metadata'

/**
 * draft/metadata-2 — your profile, as the network carries it.
 *
 * The cases here are the ones that quietly corrupt a profile rather than
 * failing: a key cleared and echoed back wrong, a value that looks like a key,
 * a server that answers in one of the two shapes the numeric allows.
 */

function client(nick = 'kara') {
  const state = new ConnectionState()
  state.nick = nick
  const events = new EventEmitter()
  const seen: { target: string; key: string; value: string }[] = []
  events.on('metadata', (data) => seen.push(data))
  return { state, events, seen }
}

const feed = (c: ReturnType<typeof client>, line: string) =>
  dispatchMessage(c, parseMessage(line))

/** What the connection holds for a target, as the snapshot would hand it over */
const stored = (c: ReturnType<typeof client>, target: string) =>
  (c.state.metadata as Map<string, Record<string, string>>).get(target.toLowerCase())

describe('reading metadata off the wire', () => {
  let c: ReturnType<typeof client>

  beforeEach(() => {
    c = client()
  })

  it('takes a value with the visibility field present', () => {
    feed(c, ':irc.test 761 kara kara pronouns * she/her')

    expect(stored(c, 'kara')).toEqual({ pronouns: 'she/her' })
    expect(c.seen).toEqual([{ target: 'kara', key: 'pronouns', value: 'she/her' }])
  })

  it('takes a value with the visibility field absent', () => {
    feed(c, ':irc.test 761 kara kara pronouns :they/them')

    expect(stored(c, 'kara')).toEqual({ pronouns: 'they/them' })
  })

  it('ignores a reply that carries no value at all', () => {
    feed(c, ':irc.test 761 kara kara pronouns')

    expect(stored(c, 'kara')).toBeUndefined()
  })

  it('treats RPL_KEYNOTSET as the key being gone', () => {
    feed(c, ':irc.test 761 kara kara pronouns * she/her')
    feed(c, ':irc.test 766 kara kara pronouns :key not set')

    expect(stored(c, 'kara')).toBeUndefined()
  })

  /**
   * The one that made a mess. A server answering our clear with the key
   * repeated where the value belongs is indistinguishable from someone setting
   * their pronouns to the word "pronouns" — unless you know you just cleared it.
   */
  it('does not read a cleared key back as its own name', () => {
    feed(c, ':irc.test 761 kara kara pronouns * she/her')
    expect(stored(c, 'kara')).toEqual({ pronouns: 'she/her' })

    expectCleared(c, 'pronouns')
    feed(c, ':irc.test 761 kara kara pronouns * pronouns')

    expect(stored(c, 'kara')).toBeUndefined()
    expect(c.seen.at(-1)).toEqual({ target: 'kara', key: 'pronouns', value: '' })
  })

  it('still lets someone set a value that happens to match the key', () => {
    // Nothing was cleared, so this is a person being funny, not a bad echo
    feed(c, ':irc.test 761 kara kara status * status')

    expect(stored(c, 'kara')).toEqual({ status: 'status' })
  })

  it('only forgives the one echo it was waiting for', () => {
    expectCleared(c, 'pronouns')
    feed(c, ':irc.test 761 kara kara pronouns * pronouns')
    // A second one is a real value, however odd
    feed(c, ':irc.test 761 kara kara pronouns * pronouns')

    expect(stored(c, 'kara')).toEqual({ pronouns: 'pronouns' })
  })

  it('keeps other people separate from us', () => {
    feed(c, ':irc.test 761 kara robin pronouns * he/him')
    feed(c, ':irc.test 761 kara kara pronouns * she/her')

    expect(stored(c, 'robin')).toEqual({ pronouns: 'he/him' })
    expect(stored(c, 'kara')).toEqual({ pronouns: 'she/her' })
  })
})
