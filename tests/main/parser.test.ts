import { describe, it, expect } from 'vitest'
import { parseMessage } from '../../src/main/irc/parser'

describe('IRC Message Parser', () => {
  it('parses a simple PRIVMSG', () => {
    const msg = parseMessage(':nick!user@host PRIVMSG #channel :Hello world')
    expect(msg.command).toBe('PRIVMSG')
    expect(msg.prefix).toBe('nick!user@host')
    expect(msg.source?.nick).toBe('nick')
    expect(msg.source?.user).toBe('user')
    expect(msg.source?.host).toBe('host')
    expect(msg.params).toEqual(['#channel', 'Hello world'])
  })

  it('parses a message with IRCv3 tags', () => {
    const msg = parseMessage('@time=2024-03-18T12:00:00Z;msgid=abc123 :nick!user@host PRIVMSG #test :tagged message')
    expect(msg.tags).toEqual({ time: '2024-03-18T12:00:00Z', msgid: 'abc123' })
    expect(msg.command).toBe('PRIVMSG')
    expect(msg.params).toEqual(['#test', 'tagged message'])
  })

  it('parses tags with boolean (no value) tags', () => {
    const msg = parseMessage('@draft/reply;account=foo :nick PRIVMSG #ch :hi')
    expect(msg.tags['draft/reply']).toBe(true)
    expect(msg.tags['account']).toBe('foo')
  })

  it('handles tag value escaping', () => {
    const msg = parseMessage('@msg=hello\\sworld\\:\\n :nick PRIVMSG #ch :test')
    expect(msg.tags['msg']).toBe('hello world;\n')
  })

  it('parses PING with no prefix', () => {
    const msg = parseMessage('PING :server.example.com')
    expect(msg.command).toBe('PING')
    expect(msg.prefix).toBeNull()
    expect(msg.source).toBeNull()
    expect(msg.params).toEqual(['server.example.com'])
  })

  it('parses numeric replies', () => {
    const msg = parseMessage(':server 001 nick :Welcome to the network')
    expect(msg.command).toBe('001')
    expect(msg.source?.nick).toBe('server')
    expect(msg.params).toEqual(['nick', 'Welcome to the network'])
  })

  it('parses JOIN with extended-join', () => {
    const msg = parseMessage(':nick!user@host JOIN #channel accountname :Real Name')
    expect(msg.command).toBe('JOIN')
    expect(msg.params).toEqual(['#channel', 'accountname', 'Real Name'])
  })

  it('parses CAP LS', () => {
    const msg = parseMessage(':server CAP * LS :multi-prefix sasl message-tags')
    expect(msg.command).toBe('CAP')
    expect(msg.params).toEqual(['*', 'LS', 'multi-prefix sasl message-tags'])
  })

  it('strips trailing CRLF', () => {
    const msg = parseMessage(':nick QUIT :Leaving\r\n')
    expect(msg.command).toBe('QUIT')
    expect(msg.params).toEqual(['Leaving'])
  })

  it('parses prefix with only nick (server name)', () => {
    const msg = parseMessage(':irc.server.net 372 nick :- Welcome')
    expect(msg.source?.nick).toBe('irc.server.net')
    expect(msg.source?.user).toBeNull()
    expect(msg.source?.host).toBeNull()
  })
})
