import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  ctcpReply,
  ctcpKind,
  ctcpBody,
  ctcpAnswerLine,
  CtcpGuard,
  CTCP_WINDOW_MS,
  CTCP_PER_ASKER,
  CTCP_TOTAL,
  type CtcpKind
} from '@shared/ctcp'

const corpus = JSON.parse(readFileSync(join(__dirname, '../fixtures/ctcp.json'), 'utf8')) as {
  version: string
  platform: string
  now: string
  replies: { name: string; verb: string; args: string; reply: string | null }[]
  kinds: { name: string; command: string; text: string; kind: CtcpKind | null }[]
  answerLines: { name: string; from: string; body: string; line: string }[]
}

describe('answering a CTCP question', () => {
  const about = {
    version: corpus.version,
    platform: corpus.platform,
    now: new Date(corpus.now)
  }

  for (const c of corpus.replies) {
    it(c.name, () => {
      expect(ctcpReply(c.verb, c.args, about)).toBe(c.reply)
    })
  }
})

describe('what a wrapped line actually is', () => {
  for (const c of corpus.kinds) {
    it(c.name, () => {
      expect(ctcpKind(c.command, c.text)).toBe(c.kind)
    })
  }

  it('unwraps what is inside', () => {
    expect(ctcpBody('\x01VERSION HexChat\x01')).toBe('VERSION HexChat')
    // Nothing to unwrap is not an error; it is an ordinary line
    expect(ctcpBody('hello')).toBe('hello')
  })
})

describe('an answer somebody sent back', () => {
  for (const c of corpus.answerLines) {
    it(c.name, () => {
      expect(ctcpAnswerLine(c.from, c.body)).toBe(c.line)
    })
  }
})

describe('how often it is willing to answer', () => {
  it('answers a question asked once', () => {
    // The whole point. Somebody surveying a channel got a reply from every
    // client in the room except this one.
    expect(new CtcpGuard().allow('asker', 1_000)).toBe(true)
  })

  it('answers somebody asking two or three things in a row', () => {
    // Which is what asking looks like: send VERSION, read it, send SOURCE
    const guard = new CtcpGuard()
    for (let i = 0; i < CTCP_PER_ASKER; i++) {
      expect(guard.allow('asker', 1_000 + i * 100)).toBe(true)
    }
  })

  it('stops answering somebody who will not stop asking', () => {
    const guard = new CtcpGuard()
    for (let i = 0; i < CTCP_PER_ASKER; i++) guard.allow('asker', 1_000 + i)
    expect(guard.allow('asker', 1_500)).toBe(false)
  })

  it('answers them again once the window has passed', () => {
    const guard = new CtcpGuard()
    for (let i = 0; i < CTCP_PER_ASKER; i++) guard.allow('asker', 1_000)
    expect(guard.allow('asker', 1_000 + CTCP_WINDOW_MS)).toBe(true)
  })

  it('does not care how the asker spelled their own nick', () => {
    const guard = new CtcpGuard()
    for (let i = 0; i < CTCP_PER_ASKER; i++) guard.allow('Asker', 1_000 + i)
    expect(guard.allow('aSKER', 1_100)).toBe(false)
  })

  it('caps what a crowd can make it send', () => {
    const guard = new CtcpGuard()
    for (let i = 0; i < CTCP_TOTAL; i++) {
      expect(guard.allow(`asker${i}`, 1_000 + i)).toBe(true)
    }

    // Without this a stranger can make this client send as many messages as
    // they have nicks, and the network kills the client rather than them
    expect(guard.allow('one-too-many', 1_100)).toBe(false)
  })

  it('takes more once the window has passed', () => {
    const guard = new CtcpGuard()
    for (let i = 0; i < CTCP_TOTAL; i++) guard.allow(`asker${i}`, 1_000)
    expect(guard.allow('later', 1_000 + CTCP_WINDOW_MS)).toBe(true)
  })

  it('does not grow without limit on a busy network', () => {
    const guard = new CtcpGuard()
    // Well past the window each time, so none of them can refuse anything
    for (let i = 0; i < 2_000; i++) guard.allow(`asker${i}`, i * CTCP_WINDOW_MS)
    const kept = (guard as unknown as { answered: Map<string, number[]> }).answered
    expect(kept.size).toBeLessThan(600)
  })
})
