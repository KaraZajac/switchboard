import { describe, it, expect, beforeEach } from 'vitest'
import {
  maskSecrets,
  rememberRaw,
  rawLogFor,
  clearRawLog,
  RAW_LOG_LIMIT
} from '../../src/main/irc/rawlog'

/**
 * The wire log.
 *
 * Every mainstream client has one, and it is the thing you reach for when a
 * network will not behave. The risk it carries is that the wire is where
 * credentials are, in the clear — so masking happens as a line is kept, not
 * as it is shown, and a log that is copied or saved has never held one.
 */

beforeEach(() => {
  clearRawLog('srv')
  clearRawLog('other')
})

describe('keeping credentials out of the log', () => {
  it('masks the server password', () => {
    expect(maskSecrets('PASS hunter2')).toBe('PASS ***')
  })

  it('masks SASL, which is one base64 step from the password', () => {
    expect(maskSecrets('AUTHENTICATE aHVudGVyMgBodW50ZXIyAHM=')).toBe('AUTHENTICATE ***')
  })

  it('masks an oper login', () => {
    expect(maskSecrets('OPER kara hunter2')).toBe('OPER ***')
  })

  it('masks identifying to services by hand', () => {
    expect(maskSecrets('PRIVMSG NickServ :IDENTIFY hunter2')).toBe('PRIVMSG NickServ :IDENTIFY ***')
  })

  it('masks setting a new password there', () => {
    expect(maskSecrets('PRIVMSG NickServ :SET PASSWORD hunter2')).toBe(
      'PRIVMSG NickServ :SET PASSWORD ***'
    )
  })

  it('leaves an ordinary message alone, including the word pass', () => {
    expect(maskSecrets('PRIVMSG #lobby :I will pass on that')).toBe(
      'PRIVMSG #lobby :I will pass on that'
    )
  })

  it('leaves what the server says alone', () => {
    expect(maskSecrets(':irc.netslum.io 001 sbtest :Welcome')).toBe(
      ':irc.netslum.io 001 sbtest :Welcome'
    )
  })

  it('keeps which command it was, because that is the part worth reading', () => {
    expect(maskSecrets('PASS hunter2')).toContain('PASS')
  })
})

describe('what the log holds', () => {
  it('keeps lines in the order they happened, with their direction', () => {
    rememberRaw('srv', 'out', 'NICK sbtest')
    rememberRaw('srv', 'in', ':irc 001 sbtest :Welcome')

    expect(rawLogFor('srv').map((l) => `${l.direction} ${l.line}`)).toEqual([
      'out NICK sbtest',
      'in :irc 001 sbtest :Welcome'
    ])
  })

  it('stores the line already masked', () => {
    rememberRaw('srv', 'out', 'PASS hunter2')

    expect(rawLogFor('srv')[0].line).toBe('PASS ***')
  })

  it('timestamps each line', () => {
    rememberRaw('srv', 'out', 'PING :x')

    expect(rawLogFor('srv')[0].at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('keeps one network apart from another', () => {
    rememberRaw('srv', 'out', 'NICK a')
    rememberRaw('other', 'out', 'NICK b')

    expect(rawLogFor('srv')).toHaveLength(1)
    expect(rawLogFor('other')[0].line).toBe('NICK b')
  })

  it('is bounded, and keeps the newest', () => {
    for (let i = 0; i < RAW_LOG_LIMIT + 50; i++) rememberRaw('srv', 'out', `PING :${i}`)

    const kept = rawLogFor('srv')
    expect(kept).toHaveLength(RAW_LOG_LIMIT)
    expect(kept[kept.length - 1].line).toBe(`PING :${RAW_LOG_LIMIT + 49}`)
  })

  it('can be emptied', () => {
    rememberRaw('srv', 'out', 'PING :x')
    clearRawLog('srv')

    expect(rawLogFor('srv')).toEqual([])
  })

  it('hands back a copy, so the caller cannot edit the log', () => {
    rememberRaw('srv', 'out', 'PING :x')
    rawLogFor('srv').push({ at: 'x', direction: 'in', line: 'forged' })

    expect(rawLogFor('srv')).toHaveLength(1)
  })

  it('a network nothing has happened on is empty, not missing', () => {
    expect(rawLogFor('never-seen')).toEqual([])
  })
})
