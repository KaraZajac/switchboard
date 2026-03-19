import { describe, it, expect } from 'vitest'
import { serializeMessage, cmd } from '../../src/main/irc/serializer'

describe('IRC Message Serializer', () => {
  it('serializes a simple PRIVMSG', () => {
    const line = serializeMessage({
      command: 'PRIVMSG',
      params: ['#channel', 'Hello world']
    })
    expect(line).toBe('PRIVMSG #channel :Hello world')
  })

  it('serializes with tags', () => {
    const line = serializeMessage({
      tags: { '+typing': 'active' },
      command: 'TAGMSG',
      params: ['#channel']
    })
    expect(line).toBe('@+typing=active TAGMSG #channel')
  })

  it('serializes boolean tags', () => {
    const line = serializeMessage({
      tags: { 'draft/reply': true },
      command: 'PRIVMSG',
      params: ['#ch', 'hi']
    })
    expect(line).toBe('@draft/reply PRIVMSG #ch :hi')
  })

  it('escapes tag values', () => {
    const line = serializeMessage({
      tags: { msg: 'hello world;\n' },
      command: 'PRIVMSG',
      params: ['#ch', 'test']
    })
    expect(line).toBe('@msg=hello\\sworld\\:\\n PRIVMSG #ch :test')
  })

  it('serializes with prefix', () => {
    const line = serializeMessage({
      prefix: 'nick!user@host',
      command: 'PRIVMSG',
      params: ['#channel', 'text']
    })
    expect(line).toBe(':nick!user@host PRIVMSG #channel :text')
  })

  it('cmd helper builds simple commands', () => {
    expect(cmd('NICK', 'myNick')).toBe('NICK myNick')
    expect(cmd('JOIN', '#channel')).toBe('JOIN #channel')
    expect(cmd('PRIVMSG', '#test', 'Hello world')).toBe('PRIVMSG #test :Hello world')
    expect(cmd('PING', 'server.example.com')).toBe('PING server.example.com')
  })
})
