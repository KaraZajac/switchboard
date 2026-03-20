import { describe, it, expect, beforeEach, vi } from 'vitest'
import { EventEmitter } from 'events'
import { parseMessage } from '../../src/main/irc/parser'
import { ConnectionState } from '../../src/main/irc/state'
import { dispatchMessage } from '../../src/main/irc/handlers/registry'

// Import handler modules to register them (side-effect imports)
import '../../src/main/irc/handlers/registration'
import '../../src/main/irc/handlers/channel'
import '../../src/main/irc/handlers/message'
import '../../src/main/irc/handlers/user'
import '../../src/main/irc/handlers/error'
import '../../src/main/irc/capability'
import '../../src/main/irc/sasl'
import '../../src/main/irc/features/account'
import '../../src/main/irc/features/away'
import '../../src/main/irc/features/chghost'
import '../../src/main/irc/features/setname'
import '../../src/main/irc/features/monitor'
import '../../src/main/irc/features/whox'
import '../../src/main/irc/features/batch'
import '../../src/main/irc/features/labeled'
import '../../src/main/irc/features/readmarker'
import '../../src/main/irc/features/rename'
import '../../src/main/irc/features/redact'

/**
 * Create a mock IRCClient for handler testing.
 */
function createMockClient(overrides: Partial<{
  nick: string
  autoJoin: string[]
}> = {}) {
  const state = new ConnectionState()
  state.nick = overrides.nick || 'TestUser'

  const events = new EventEmitter()

  const sentLines: string[] = []
  const connection = {
    send: (...args: string[]) => {
      sentLines.push(args.join(' '))
    },
    sendRaw: (line: string) => {
      sentLines.push(line)
    }
  }

  const config = {
    nick: overrides.nick || 'TestUser',
    autoJoin: overrides.autoJoin || [],
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

describe('Registration Handlers', () => {
  it('handles RPL_WELCOME (001)', () => {
    const { client, events, state } = createMockClient()
    const handler = vi.fn()
    events.on('registered', handler)

    const msg = parseMessage(':irc.server.net 001 TestUser :Welcome to the network')
    dispatchMessage(client, msg)

    expect(state.nick).toBe('TestUser')
    expect(state.registrationState).toBe('connected')
    expect(handler).toHaveBeenCalledWith({
      nick: 'TestUser',
      message: 'Welcome to the network'
    })
  })

  it('auto-joins channels on 001', () => {
    vi.useFakeTimers()
    const { client, sentLines } = createMockClient({
      autoJoin: ['#general', '#dev']
    })

    const msg = parseMessage(':server 001 TestUser :Welcome')
    dispatchMessage(client, msg)

    vi.runAllTimers()

    expect(sentLines).toContain('JOIN #general')
    expect(sentLines).toContain('JOIN #dev')
    vi.useRealTimers()
  })

  it('handles RPL_ISUPPORT (005)', () => {
    const { client, state } = createMockClient()

    const msg = parseMessage(':server 005 TestUser CHANTYPES=#& PREFIX=(ov)@+ NETWORK=TestNet :are supported')
    dispatchMessage(client, msg)

    expect(state.isupport['CHANTYPES']).toBe('#&')
    expect(state.isupport['PREFIX']).toBe('(ov)@+')
    expect(state.isupport['NETWORK']).toBe('TestNet')
  })

  it('handles ERR_NICKNAMEINUSE (433) during registration', () => {
    const { client, sentLines, state } = createMockClient()
    state.registrationState = 'registering'

    const msg = parseMessage(':server 433 * TestUser :Nickname is already in use')
    dispatchMessage(client, msg)

    expect(sentLines).toContain('NICK TestUser_')
    expect(state.nick).toBe('TestUser_')
  })

  it('accumulates MOTD lines', () => {
    const { client, events } = createMockClient()
    const handler = vi.fn()
    events.on('motd', handler)

    dispatchMessage(client, parseMessage(':server 375 TestUser :- server Message of the Day -'))
    dispatchMessage(client, parseMessage(':server 372 TestUser :- Welcome to TestNet'))
    dispatchMessage(client, parseMessage(':server 372 TestUser :- Enjoy your stay'))
    dispatchMessage(client, parseMessage(':server 376 TestUser :End of /MOTD'))

    expect(handler).toHaveBeenCalledWith([
      '- Welcome to TestNet',
      '- Enjoy your stay'
    ])
  })

  it('handles NICK change', () => {
    const { client, events, state } = createMockClient()
    state.getChannel('#general').setUser('TestUser', { nick: 'TestUser', prefixes: ['@'] })

    const handler = vi.fn()
    events.on('nick', handler)

    dispatchMessage(client, parseMessage(':TestUser!user@host NICK NewNick'))

    expect(state.nick).toBe('NewNick')
    expect(handler).toHaveBeenCalledWith({ oldNick: 'TestUser', newNick: 'NewNick' })

    // User renamed in channel
    const ch = state.getChannel('#general')
    expect(ch.hasUser('NewNick')).toBe(true)
    expect(ch.hasUser('TestUser')).toBe(false)
  })
})

describe('Channel Handlers', () => {
  it('handles JOIN (self)', () => {
    const { client, events, state } = createMockClient()
    const handler = vi.fn()
    events.on('join', handler)

    dispatchMessage(client, parseMessage(':TestUser!user@host JOIN #newchan'))

    expect(state.inChannel('#newchan')).toBe(true)
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({
      channel: '#newchan',
      isMe: true
    }))
  })

  it('handles JOIN with extended-join', () => {
    const { client, events, state } = createMockClient()
    state.getChannel('#chan') // We're already in the channel
    const handler = vi.fn()
    events.on('join', handler)

    dispatchMessage(client, parseMessage(':Other!other@host JOIN #chan account123 :Real Name'))

    expect(handler).toHaveBeenCalledWith(expect.objectContaining({
      channel: '#chan',
      user: expect.objectContaining({
        nick: 'Other',
        account: 'account123',
        realname: 'Real Name'
      }),
      isMe: false
    }))
  })

  it('handles PART (self)', () => {
    const { client, events, state } = createMockClient()
    state.getChannel('#test')

    const handler = vi.fn()
    events.on('part', handler)

    dispatchMessage(client, parseMessage(':TestUser!user@host PART #test :Goodbye'))

    expect(state.inChannel('#test')).toBe(false)
    expect(handler).toHaveBeenCalledWith({
      channel: '#test',
      nick: 'TestUser',
      reason: 'Goodbye',
      isMe: true
    })
  })

  it('handles KICK', () => {
    const { client, events, state } = createMockClient()
    const ch = state.getChannel('#test')
    ch.setUser('Victim', { nick: 'Victim' })

    const handler = vi.fn()
    events.on('kick', handler)

    dispatchMessage(client, parseMessage(':Op!op@host KICK #test Victim :Bye'))

    expect(ch.hasUser('Victim')).toBe(false)
    expect(handler).toHaveBeenCalledWith({
      channel: '#test',
      nick: 'Victim',
      by: 'Op',
      reason: 'Bye',
      isMe: false
    })
  })

  it('handles TOPIC', () => {
    const { client, events, state } = createMockClient()
    state.getChannel('#test')

    const handler = vi.fn()
    events.on('topic', handler)

    dispatchMessage(client, parseMessage(':Nick!user@host TOPIC #test :New topic here'))

    const ch = state.getChannel('#test')
    expect(ch.topic).toBe('New topic here')
    expect(ch.topicSetBy).toBe('Nick')
    expect(handler).toHaveBeenCalledWith({
      channel: '#test',
      topic: 'New topic here',
      setBy: 'Nick'
    })
  })

  it('parses RPL_NAMREPLY (353) with prefixes', () => {
    const { client, state } = createMockClient()
    state.getChannel('#test')

    dispatchMessage(client, parseMessage(':server 353 TestUser = #test :@Op +Voiced Regular'))

    const ch = state.getChannel('#test')
    expect(ch.users.size).toBe(3)

    const op = ch.users.get('op')!
    expect(op.nick).toBe('Op')
    expect(op.prefixes).toEqual(['@'])

    const voiced = ch.users.get('voiced')!
    expect(voiced.prefixes).toEqual(['+'])

    const regular = ch.users.get('regular')!
    expect(regular.prefixes).toEqual([])
  })

  it('parses RPL_NAMREPLY (353) with userhost-in-names', () => {
    const { client, state } = createMockClient()
    state.getChannel('#test')

    dispatchMessage(client, parseMessage(':server 353 TestUser = #test :@Op!op@host.com +Voiced!voiced@other.net'))

    const ch = state.getChannel('#test')
    const op = ch.users.get('op')!
    expect(op.nick).toBe('Op')
    expect(op.user).toBe('op')
    expect(op.host).toBe('host.com')
    expect(op.prefixes).toEqual(['@'])
  })

  it('emits names on RPL_ENDOFNAMES (366)', () => {
    const { client, events, state } = createMockClient()
    state.getChannel('#test')
    const handler = vi.fn()
    events.on('names', handler)

    dispatchMessage(client, parseMessage(':server 353 TestUser = #test :@Op Regular'))
    dispatchMessage(client, parseMessage(':server 366 TestUser #test :End of /NAMES'))

    expect(handler).toHaveBeenCalledWith({
      channel: '#test',
      users: expect.arrayContaining([
        expect.objectContaining({ nick: 'Op', prefixes: ['@'] }),
        expect.objectContaining({ nick: 'Regular', prefixes: [] })
      ])
    })
  })

  it('handles MODE with prefix changes', () => {
    const { client, state } = createMockClient()
    const ch = state.getChannel('#test')
    ch.setUser('Alice', { nick: 'Alice', prefixes: [] })

    dispatchMessage(client, parseMessage(':Op!op@host MODE #test +o Alice'))

    const alice = ch.users.get('alice')!
    expect(alice.prefixes).toContain('@')
  })

  it('handles INVITE', () => {
    const { client, events } = createMockClient()
    const handler = vi.fn()
    events.on('invite', handler)

    dispatchMessage(client, parseMessage(':Friend!f@host INVITE TestUser #secret'))

    expect(handler).toHaveBeenCalledWith({
      channel: '#secret',
      by: 'Friend',
      target: 'TestUser',
      isMe: true
    })
  })
})

describe('Message Handlers', () => {
  it('handles PRIVMSG to channel', () => {
    const { client, events } = createMockClient()
    const handler = vi.fn()
    events.on('privmsg', handler)

    dispatchMessage(client, parseMessage(':Alice!alice@host PRIVMSG #general :Hello everyone'))

    expect(handler).toHaveBeenCalledWith(expect.objectContaining({
      channel: '#general',
      nick: 'Alice',
      content: 'Hello everyone',
      type: 'privmsg',
      isPrivate: false,
      isEcho: false
    }))
  })

  it('handles PRIVMSG as PM', () => {
    const { client, events } = createMockClient()
    const handler = vi.fn()
    events.on('privmsg', handler)

    dispatchMessage(client, parseMessage(':Alice!alice@host PRIVMSG TestUser :Hey there'))

    expect(handler).toHaveBeenCalledWith(expect.objectContaining({
      channel: 'Alice', // PM uses sender nick as channel
      isPrivate: true
    }))
  })

  it('handles ACTION (/me)', () => {
    const { client, events } = createMockClient()
    const handler = vi.fn()
    events.on('privmsg', handler)

    dispatchMessage(client, parseMessage(':Alice!alice@host PRIVMSG #general :\x01ACTION waves\x01'))

    expect(handler).toHaveBeenCalledWith(expect.objectContaining({
      content: 'waves',
      type: 'action'
    }))
  })

  it('detects echo messages', () => {
    const { client, events } = createMockClient()
    const handler = vi.fn()
    events.on('privmsg', handler)

    dispatchMessage(client, parseMessage(':TestUser!user@host PRIVMSG #general :My own message'))

    expect(handler).toHaveBeenCalledWith(expect.objectContaining({
      isEcho: true
    }))
  })

  it('extracts IRCv3 tags from messages', () => {
    const { client, events } = createMockClient()
    const handler = vi.fn()
    events.on('privmsg', handler)

    dispatchMessage(client, parseMessage(
      '@time=2024-03-18T12:00:00Z;msgid=abc123;account=alice_acct :Alice!a@h PRIVMSG #ch :tagged'
    ))

    expect(handler).toHaveBeenCalledWith(expect.objectContaining({
      msgid: 'abc123',
      time: '2024-03-18T12:00:00Z',
      account: 'alice_acct'
    }))
  })

  it('handles NOTICE', () => {
    const { client, events } = createMockClient()
    const handler = vi.fn()
    events.on('notice', handler)

    dispatchMessage(client, parseMessage(':Server NOTICE #channel :Server notice here'))

    expect(handler).toHaveBeenCalledWith(expect.objectContaining({
      channel: '#channel',
      nick: 'Server',
      content: 'Server notice here',
      type: 'notice'
    }))
  })

  it('handles QUIT', () => {
    const { client, events, state } = createMockClient()
    const ch = state.getChannel('#general')
    ch.setUser('Quitter', { nick: 'Quitter' })

    const handler = vi.fn()
    events.on('quit', handler)

    dispatchMessage(client, parseMessage(':Quitter!q@host QUIT :Connection reset'))

    expect(ch.hasUser('Quitter')).toBe(false)
    expect(handler).toHaveBeenCalledWith({
      nick: 'Quitter',
      reason: 'Connection reset'
    })
  })

  it('handles TAGMSG with typing notification', () => {
    const { client, events } = createMockClient()
    const handler = vi.fn()
    events.on('typing', handler)

    dispatchMessage(client, parseMessage('@+typing=active :Alice!a@h TAGMSG #general'))

    expect(handler).toHaveBeenCalledWith({
      channel: '#general',
      nick: 'Alice',
      status: 'active'
    })
  })

  it('handles TAGMSG with reaction', () => {
    const { client, events } = createMockClient()
    const handler = vi.fn()
    events.on('react', handler)

    dispatchMessage(client, parseMessage(
      '@+draft/react=👍;+reply=msg123 :Alice!a@h TAGMSG #general'
    ))

    expect(handler).toHaveBeenCalledWith({
      channel: '#general',
      nick: 'Alice',
      emoji: '👍',
      msgid: 'msg123'
    })
  })
})

describe('Error Handlers', () => {
  it('handles FAIL standard reply', () => {
    const { client, events } = createMockClient()
    const handler = vi.fn()
    events.on('error', handler)

    dispatchMessage(client, parseMessage(':server FAIL PRIVMSG CANNOT_SEND :You cannot send messages'))

    expect(handler).toHaveBeenCalledWith({
      code: 'CANNOT_SEND',
      command: 'PRIVMSG',
      message: 'You cannot send messages'
    })
  })

  it('handles common error numerics', () => {
    const { client, events } = createMockClient()
    const handler = vi.fn()
    events.on('error', handler)

    dispatchMessage(client, parseMessage(':server 403 TestUser #nonexist :No such channel'))

    expect(handler).toHaveBeenCalledWith({
      code: '403',
      command: '#nonexist',
      message: 'No such channel'
    })
  })
})

describe('WHOIS Handlers', () => {
  it('accumulates and emits WHOIS data', () => {
    const { client, events } = createMockClient()
    const handler = vi.fn()
    events.on('whois', handler)

    dispatchMessage(client, parseMessage(':server 311 TestUser Alice alice host.com * :Alice Real'))
    dispatchMessage(client, parseMessage(':server 312 TestUser Alice irc.server.net :Test Server'))
    dispatchMessage(client, parseMessage(':server 319 TestUser Alice :#general @#ops'))
    dispatchMessage(client, parseMessage(':server 330 TestUser Alice alice_acct :is logged in as'))
    dispatchMessage(client, parseMessage(':server 318 TestUser Alice :End of /WHOIS'))

    expect(handler).toHaveBeenCalledWith({
      nick: 'Alice',
      user: 'alice',
      host: 'host.com',
      realname: 'Alice Real',
      server: 'irc.server.net',
      serverInfo: 'Test Server',
      channels: '#general @#ops',
      account: 'alice_acct'
    })
  })
})

// ==================== Phase 4: Presence & User Tracking ====================

describe('ACCOUNT Handler', () => {
  it('updates account across all channels', () => {
    const { client, events, state } = createMockClient()
    const ch1 = state.getChannel('#general')
    const ch2 = state.getChannel('#dev')
    ch1.setUser('Alice', { nick: 'Alice', account: null })
    ch2.setUser('Alice', { nick: 'Alice', account: null })

    const handler = vi.fn()
    events.on('account', handler)

    dispatchMessage(client, parseMessage(':Alice!alice@host ACCOUNT alice_acct'))

    expect(ch1.users.get('alice')!.account).toBe('alice_acct')
    expect(ch2.users.get('alice')!.account).toBe('alice_acct')
    expect(handler).toHaveBeenCalledWith({ nick: 'Alice', account: 'alice_acct' })
  })

  it('handles logout (account = *)', () => {
    const { client, events, state } = createMockClient()
    const ch = state.getChannel('#general')
    ch.setUser('Alice', { nick: 'Alice', account: 'alice_acct' })

    const handler = vi.fn()
    events.on('account', handler)

    dispatchMessage(client, parseMessage(':Alice!alice@host ACCOUNT *'))

    expect(ch.users.get('alice')!.account).toBeNull()
    expect(handler).toHaveBeenCalledWith({ nick: 'Alice', account: null })
  })
})

describe('AWAY Handler', () => {
  it('marks user as away with message', () => {
    const { client, events, state } = createMockClient()
    const ch = state.getChannel('#general')
    ch.setUser('Alice', { nick: 'Alice', away: false })

    const handler = vi.fn()
    events.on('away', handler)

    dispatchMessage(client, parseMessage(':Alice!alice@host AWAY :Gone fishing'))

    expect(ch.users.get('alice')!.away).toBe(true)
    expect(ch.users.get('alice')!.awayMessage).toBe('Gone fishing')
    expect(handler).toHaveBeenCalledWith({ nick: 'Alice', message: 'Gone fishing' })
  })

  it('marks user as back (no params)', () => {
    const { client, events, state } = createMockClient()
    const ch = state.getChannel('#general')
    ch.setUser('Alice', { nick: 'Alice', away: true, awayMessage: 'brb' })

    const handler = vi.fn()
    events.on('away', handler)

    dispatchMessage(client, parseMessage(':Alice!alice@host AWAY'))

    expect(ch.users.get('alice')!.away).toBe(false)
    expect(handler).toHaveBeenCalledWith({ nick: 'Alice', message: null })
  })

  it('handles RPL_UNAWAY (305)', () => {
    const { client, events } = createMockClient()
    const handler = vi.fn()
    events.on('away', handler)

    dispatchMessage(client, parseMessage(':server 305 TestUser :You are no longer marked as being away'))

    expect(handler).toHaveBeenCalledWith({ nick: 'TestUser', message: null })
  })

  it('handles RPL_NOWAWAY (306)', () => {
    const { client, events } = createMockClient()
    const handler = vi.fn()
    events.on('away', handler)

    dispatchMessage(client, parseMessage(':server 306 TestUser :You have been marked as being away'))

    expect(handler).toHaveBeenCalledWith({ nick: 'TestUser', message: 'You have been marked as being away' })
  })
})

describe('CHGHOST Handler', () => {
  it('updates user/host across all channels', () => {
    const { client, events, state } = createMockClient()
    const ch1 = state.getChannel('#general')
    const ch2 = state.getChannel('#dev')
    ch1.setUser('Alice', { nick: 'Alice', user: 'olduser', host: 'old.host' })
    ch2.setUser('Alice', { nick: 'Alice', user: 'olduser', host: 'old.host' })

    const handler = vi.fn()
    events.on('chghost', handler)

    dispatchMessage(client, parseMessage(':Alice!olduser@old.host CHGHOST newuser new.host'))

    expect(ch1.users.get('alice')!.user).toBe('newuser')
    expect(ch1.users.get('alice')!.host).toBe('new.host')
    expect(ch2.users.get('alice')!.user).toBe('newuser')
    expect(handler).toHaveBeenCalledWith({ nick: 'Alice', newUser: 'newuser', newHost: 'new.host' })
  })
})

describe('SETNAME Handler', () => {
  it('updates realname across all channels', () => {
    const { client, events, state } = createMockClient()
    const ch = state.getChannel('#general')
    ch.setUser('Alice', { nick: 'Alice', realname: 'Old Name' })

    const handler = vi.fn()
    events.on('setname', handler)

    dispatchMessage(client, parseMessage(':Alice!alice@host SETNAME :Alice Wonderland'))

    expect(ch.users.get('alice')!.realname).toBe('Alice Wonderland')
    expect(handler).toHaveBeenCalledWith({ nick: 'Alice', realname: 'Alice Wonderland' })
  })
})

describe('MONITOR Handlers', () => {
  it('handles RPL_MONONLINE (730) with nick!user@host', () => {
    const { client, events } = createMockClient()
    const handler = vi.fn()
    events.on('monitorOnline', handler)

    dispatchMessage(client, parseMessage(':server 730 TestUser :Alice!alice@host.com,Bob!bob@other.net'))

    expect(handler).toHaveBeenCalledTimes(2)
    expect(handler).toHaveBeenCalledWith({ nick: 'Alice', user: 'alice', host: 'host.com' })
    expect(handler).toHaveBeenCalledWith({ nick: 'Bob', user: 'bob', host: 'other.net' })
  })

  it('handles RPL_MONOFFLINE (731)', () => {
    const { client, events } = createMockClient()
    const handler = vi.fn()
    events.on('monitorOffline', handler)

    dispatchMessage(client, parseMessage(':server 731 TestUser :Alice,Bob'))

    expect(handler).toHaveBeenCalledTimes(2)
    expect(handler).toHaveBeenCalledWith({ nick: 'Alice' })
    expect(handler).toHaveBeenCalledWith({ nick: 'Bob' })
  })

  it('handles RPL_MONLIST (732)', () => {
    const { client, events } = createMockClient()
    const handler = vi.fn()
    events.on('monitorList', handler)

    dispatchMessage(client, parseMessage(':server 732 TestUser :Alice,Bob,Charlie'))

    expect(handler).toHaveBeenCalledWith({ nicks: ['Alice', 'Bob', 'Charlie'] })
  })

  it('handles ERR_MONLISTFULL (734)', () => {
    const { client, events } = createMockClient()
    const handler = vi.fn()
    events.on('error', handler)

    dispatchMessage(client, parseMessage(':server 734 TestUser 100 Alice,Bob :Monitor list is full'))

    expect(handler).toHaveBeenCalledWith({
      code: '734',
      command: 'MONITOR',
      message: 'Monitor list is full (limit: 100)'
    })
  })
})

describe('WHOX Handler', () => {
  it('handles RPL_WHOSPCRPL (354) with full fields', () => {
    const { client, state } = createMockClient()
    const ch = state.getChannel('#general')

    // params: <nick> <token> <channel> <user> <host> <server> <nick> <flags> <account> <realname>
    dispatchMessage(client, parseMessage(
      ':server 354 TestUser switchboard #general alice host.com irc.net Alice G@B alice_acct :Alice Real'
    ))

    const user = ch.users.get('alice')!
    expect(user.nick).toBe('Alice')
    expect(user.user).toBe('alice')
    expect(user.host).toBe('host.com')
    expect(user.account).toBe('alice_acct')
    expect(user.realname).toBe('Alice Real')
    expect(user.away).toBe(true) // G = gone
    expect(user.isBot).toBe(true) // B = bot
    expect(user.prefixes).toContain('@')
  })

  it('ignores WHOX responses with wrong token', () => {
    const { client, state } = createMockClient()
    const ch = state.getChannel('#general')

    dispatchMessage(client, parseMessage(
      ':server 354 TestUser othertoken #general alice host.com irc.net Alice H alice_acct :Alice Real'
    ))

    expect(ch.users.size).toBe(0)
  })

  it('handles RPL_ENDOFWHO (315) emitting names', () => {
    const { client, events, state } = createMockClient()
    const ch = state.getChannel('#general')
    ch.setUser('Alice', { nick: 'Alice', prefixes: ['@'] })

    const handler = vi.fn()
    events.on('names', handler)

    dispatchMessage(client, parseMessage(':server 315 TestUser #general :End of /WHO list'))

    expect(handler).toHaveBeenCalledWith({
      channel: '#general',
      users: expect.arrayContaining([
        expect.objectContaining({ nick: 'Alice' })
      ])
    })
  })
})

// ==================== Phase 5: Message Features ====================

describe('BATCH Handler', () => {
  it('starts and ends a batch', () => {
    const { client, events, state } = createMockClient()
    const handler = vi.fn()
    events.on('chathistoryBatch', handler)

    // Start batch
    dispatchMessage(client, parseMessage(':server BATCH +ref1 chathistory #general'))
    expect(state.batches.has('ref1')).toBe(true)

    // End batch
    dispatchMessage(client, parseMessage(':server BATCH -ref1'))
    expect(state.batches.has('ref1')).toBe(false)
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({
      target: '#general',
      messages: []
    }))
  })

  it('buffers messages via checkBatchMembership', async () => {
    const { checkBatchMembership } = await import('../../src/main/irc/features/batch')
    const { client, events, state } = createMockClient()
    const handler = vi.fn()
    events.on('chathistoryBatch', handler)

    // Start batch
    dispatchMessage(client, parseMessage(':server BATCH +hist1 chathistory #general'))

    // Buffer a message into the batch
    const msg = parseMessage('@batch=hist1 :Alice!a@h PRIVMSG #general :Hello from history')
    const consumed = checkBatchMembership(client, msg)
    expect(consumed).toBe(true)

    // End batch — should contain the buffered message
    dispatchMessage(client, parseMessage(':server BATCH -hist1'))
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({
      target: '#general',
      messages: [expect.objectContaining({ command: 'PRIVMSG' })]
    }))
  })

  it('emits netsplit event for netsplit batch', () => {
    const { client, events, state } = createMockClient()
    const handler = vi.fn()
    events.on('netsplit', handler)

    dispatchMessage(client, parseMessage(':server BATCH +ns1 netsplit server1.net server2.net'))
    dispatchMessage(client, parseMessage(':server BATCH -ns1'))

    expect(handler).toHaveBeenCalledWith(expect.objectContaining({
      server1: 'server1.net',
      server2: 'server2.net'
    }))
  })
})

describe('Labeled Response Handler', () => {
  it('handles ACK with label tag', () => {
    const { client, events } = createMockClient()
    const handler = vi.fn()
    events.on('labeledAck', handler)

    dispatchMessage(client, parseMessage('@label=abc123 :server ACK'))

    expect(handler).toHaveBeenCalledWith({ label: 'abc123' })
  })
})

describe('MARKREAD Handler', () => {
  it('emits readMarker with channel and timestamp', () => {
    const { client, events } = createMockClient()
    const handler = vi.fn()
    events.on('readMarker', handler)

    dispatchMessage(client, parseMessage(':server MARKREAD #general timestamp=2024-03-18T12:00:00Z'))

    expect(handler).toHaveBeenCalledWith({
      channel: '#general',
      timestamp: '2024-03-18T12:00:00Z'
    })
  })

  it('ignores MARKREAD without timestamp', () => {
    const { client, events } = createMockClient()
    const handler = vi.fn()
    events.on('readMarker', handler)

    dispatchMessage(client, parseMessage(':server MARKREAD #general'))

    expect(handler).not.toHaveBeenCalled()
  })
})

describe('RENAME Handler', () => {
  it('renames channel in state and emits event', () => {
    const { client, events, state } = createMockClient()
    state.getChannel('#old-name')

    const handler = vi.fn()
    events.on('channelRename', handler)

    dispatchMessage(client, parseMessage(':server RENAME #old-name #new-name :Channel has been renamed'))

    expect(state.inChannel('#new-name')).toBe(true)
    expect(state.inChannel('#old-name')).toBe(false)
    expect(handler).toHaveBeenCalledWith({
      oldName: '#old-name',
      newName: '#new-name',
      reason: 'Channel has been renamed'
    })
  })
})

describe('REDACT Handler', () => {
  it('emits redact event with target, msgid, and reason', () => {
    const { client, events } = createMockClient()
    const handler = vi.fn()
    events.on('redact', handler)

    dispatchMessage(client, parseMessage(':Alice!alice@host REDACT #general msg123 :spam'))

    expect(handler).toHaveBeenCalledWith({
      channel: '#general',
      msgid: 'msg123',
      nick: 'Alice',
      reason: 'spam'
    })
  })

  it('handles REDACT without reason', () => {
    const { client, events } = createMockClient()
    const handler = vi.fn()
    events.on('redact', handler)

    dispatchMessage(client, parseMessage(':Alice!alice@host REDACT #general msg456'))

    expect(handler).toHaveBeenCalledWith({
      channel: '#general',
      msgid: 'msg456',
      nick: 'Alice',
      reason: null
    })
  })
})
