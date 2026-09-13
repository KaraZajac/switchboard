import { describe, it, expect, vi } from 'vitest'
import { echoLocally, hasEchoMessage } from '../../src/main/irc/features/echo'
import { sendMultilineMessage } from '../../src/main/irc/features/multiline'

/**
 * Our own messages, on a server that will not send them back.
 *
 * `echo-message` is optional and plenty of networks lack it. Without it the
 * server says nothing about what we sent, and until this the desktop said
 * nothing either: a line reached the network and never appeared in the
 * sender's own window. The phone has always shown it locally in that case.
 */

function client(caps: string[] = []) {
  return {
    connection: { send: vi.fn(), sendRaw: vi.fn() },
    events: { emit: vi.fn() },
    state: {
      capabilities: new Set(caps),
      availableCapabilities: new Map<string, string | null>(),
      nick: 'kara',
      userHost: null,
      isupport: {} as Record<string, string | true>
    }
  }
}

describe('echoing what we sent', () => {
  it('shows the message once, as ours, in the conversation it went to', () => {
    const c = client()
    echoLocally(c, '#hax', 'hello there', 'privmsg')

    expect(c.events.emit).toHaveBeenCalledTimes(1)
    const [name, data] = c.events.emit.mock.calls[0]
    expect(name).toBe('privmsg')
    expect(data).toMatchObject({
      channel: '#hax',
      nick: 'kara',
      content: 'hello there',
      type: 'privmsg',
      isEcho: true,
      tags: {}
    })
  })

  it('files a private message under the person it was sent to', () => {
    const c = client()
    echoLocally(c, 'bob', 'psst', 'privmsg')
    expect(c.events.emit.mock.calls[0][1]).toMatchObject({ channel: 'bob', nick: 'kara' })
  })

  it('shows nothing when the server has promised an echo', () => {
    const c = client(['echo-message'])
    echoLocally(c, '#hax', 'hello there', 'privmsg')
    echoLocally(c, '#hax', 'waves', 'action')
    echoLocally(c, '#hax', 'psst', 'notice')
    expect(c.events.emit).not.toHaveBeenCalled()
    expect(hasEchoMessage(c.state.capabilities)).toBe(true)
  })

  it('keeps an action an action and a notice a notice', () => {
    const c = client()
    echoLocally(c, '#hax', 'waves', 'action')
    echoLocally(c, '#hax', 'psst', 'notice')
    expect(c.events.emit.mock.calls[0][0]).toBe('privmsg')
    expect(c.events.emit.mock.calls[0][1]).toMatchObject({ type: 'action', content: 'waves' })
    expect(c.events.emit.mock.calls[1][0]).toBe('notice')
    expect(c.events.emit.mock.calls[1][1]).toMatchObject({ type: 'notice', content: 'psst' })
  })

  it('stamps the echo with the time it was sent', () => {
    const c = client()
    echoLocally(c, '#hax', 'now', 'privmsg')
    const { time } = c.events.emit.mock.calls[0][1] as { time: string }
    expect(Math.abs(Date.parse(time) - Date.now())).toBeLessThan(5_000)
  })
})

describe('echoing a message with line breaks in it', () => {
  it('shows it once, as typed, however many lines it went out as', () => {
    const c = client()
    sendMultilineMessage(c, '#hax', ['first', 'second', 'third'])

    expect(c.connection.send).toHaveBeenCalledTimes(3)
    expect(c.events.emit).toHaveBeenCalledTimes(1)
    expect(c.events.emit.mock.calls[0][1]).toMatchObject({
      channel: '#hax',
      content: 'first\nsecond\nthird'
    })
  })

  it('shows it once when it went out as a multiline batch', () => {
    const c = client(['draft/multiline'])
    c.state.availableCapabilities.set('draft/multiline', 'max-bytes=4096,max-lines=100')
    sendMultilineMessage(c, '#hax', ['first', 'second'])

    expect(c.connection.sendRaw).toHaveBeenCalledTimes(2)
    expect(c.events.emit).toHaveBeenCalledTimes(1)
    expect(c.events.emit.mock.calls[0][1]).toMatchObject({ content: 'first\nsecond' })
  })

  it('shows it once when the batch had to be split in two', () => {
    const c = client(['draft/multiline'])
    c.state.availableCapabilities.set('draft/multiline', 'max-lines=2')
    sendMultilineMessage(c, '#hax', ['a', 'b', 'c'])

    // Two lines make a batch; the one left over goes as a plain PRIVMSG.
    expect(c.connection.send.mock.calls.filter(([cmd]) => cmd === 'BATCH').length).toBe(2)
    expect(c.connection.send.mock.calls.filter(([cmd]) => cmd === 'PRIVMSG').length).toBe(1)
    expect(c.events.emit).toHaveBeenCalledTimes(1)
    expect(c.events.emit.mock.calls[0][1]).toMatchObject({ content: 'a\nb\nc' })
  })

  it('shows nothing when the server will echo the batch itself', () => {
    const c = client(['draft/multiline', 'echo-message'])
    sendMultilineMessage(c, '#hax', ['first', 'second'])
    expect(c.events.emit).not.toHaveBeenCalled()
  })
})
