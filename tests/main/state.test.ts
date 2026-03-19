import { describe, it, expect, beforeEach } from 'vitest'
import { ConnectionState, ChannelStateData } from '../../src/main/irc/state'

describe('ConnectionState', () => {
  let state: ConnectionState

  beforeEach(() => {
    state = new ConnectionState()
  })

  it('initializes with defaults', () => {
    expect(state.registrationState).toBe('disconnected')
    expect(state.nick).toBe('')
    expect(state.capabilities.size).toBe(0)
    expect(state.channels.size).toBe(0)
  })

  it('resets all state', () => {
    state.nick = 'testUser'
    state.registrationState = 'connected'
    state.capabilities.add('sasl')
    state.getChannel('#test')

    state.reset()

    expect(state.nick).toBe('')
    expect(state.registrationState).toBe('disconnected')
    expect(state.capabilities.size).toBe(0)
    expect(state.channels.size).toBe(0)
  })

  it('gets or creates channels', () => {
    const ch = state.getChannel('#Test')
    expect(ch.name).toBe('#Test')
    expect(state.channels.has('#test')).toBe(true)

    // Same channel, different case
    const ch2 = state.getChannel('#TEST')
    expect(ch2).toBe(ch)
  })

  it('removes channels', () => {
    state.getChannel('#test')
    expect(state.inChannel('#test')).toBe(true)

    state.removeChannel('#test')
    expect(state.inChannel('#test')).toBe(false)
  })

  it('tracks ISUPPORT tokens', () => {
    state.isupport['CHANTYPES'] = '#&'
    state.isupport['NETWORK'] = 'TestNet'
    state.isupport['UTF8ONLY'] = true

    expect(state.isupport['CHANTYPES']).toBe('#&')
    expect(state.isupport['NETWORK']).toBe('TestNet')
    expect(state.isupport['UTF8ONLY']).toBe(true)
  })
})

describe('ChannelStateData', () => {
  let ch: ChannelStateData

  beforeEach(() => {
    ch = new ChannelStateData('#general')
  })

  it('initializes with name', () => {
    expect(ch.name).toBe('#general')
    expect(ch.topic).toBeNull()
    expect(ch.users.size).toBe(0)
  })

  it('adds and retrieves users', () => {
    const user = ch.setUser('Alice', {
      nick: 'Alice',
      prefixes: ['@'],
      account: 'alice_acct'
    })

    expect(user.nick).toBe('Alice')
    expect(user.prefixes).toEqual(['@'])
    expect(user.account).toBe('alice_acct')
    expect(ch.hasUser('alice')).toBe(true) // case-insensitive
  })

  it('updates existing users', () => {
    ch.setUser('Alice', { nick: 'Alice', prefixes: ['@'] })
    ch.setUser('Alice', { away: true, awayMessage: 'brb' })

    const user = ch.users.get('alice')!
    expect(user.prefixes).toEqual(['@']) // preserved
    expect(user.away).toBe(true)
    expect(user.awayMessage).toBe('brb')
  })

  it('removes users', () => {
    ch.setUser('Alice', { nick: 'Alice' })
    expect(ch.hasUser('Alice')).toBe(true)

    ch.removeUser('Alice')
    expect(ch.hasUser('Alice')).toBe(false)
  })

  it('renames users', () => {
    ch.setUser('Alice', { nick: 'Alice', prefixes: ['@'] })
    ch.renameUser('Alice', 'Alice_')

    expect(ch.hasUser('Alice')).toBe(false)
    expect(ch.hasUser('Alice_')).toBe(true)

    const user = ch.users.get('alice_')!
    expect(user.nick).toBe('Alice_')
    expect(user.prefixes).toEqual(['@']) // preserved
  })
})
