import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  transcriptLine,
  transcript,
  transcriptFilename,
  type TranscriptMessage
} from '@shared/transcript'

const corpus = JSON.parse(readFileSync(join(__dirname, '../fixtures/transcript.json'), 'utf8')) as {
  lines: { name: string; message: TranscriptMessage; keepFormatting?: boolean; line: string }[]
  files: { name: string; network: string; channel: string; file: string }[]
}

describe('a conversation as text', () => {
  for (const c of corpus.lines) {
    it(c.name, () =>
      expect(transcriptLine(c.message, { keepFormatting: c.keepFormatting })).toBe(c.line))
  }

  /**
   * UTC unless asked otherwise. A log whose times move when the reader's clock
   * does is not a record of anything.
   */
  it('is in UTC by default', () => {
    const message: TranscriptMessage = {
      nick: 'kara',
      content: 'hello',
      timestamp: '2026-09-11T23:59:59.000Z',
      type: 'privmsg'
    }
    expect(transcriptLine(message)).toContain('[23:59:59]')
  })
})

describe('a whole conversation', () => {
  const messages: TranscriptMessage[] = [
    { nick: 'kara', content: 'morning', timestamp: '2026-09-10T09:00:00.000Z', type: 'privmsg' },
    { nick: 'alice', content: 'hello', timestamp: '2026-09-10T09:00:30.000Z', type: 'privmsg' },
    { nick: 'kara', content: 'still here', timestamp: '2026-09-11T09:00:00.000Z', type: 'privmsg' }
  ]

  it('says what it is, which the filename cannot', () => {
    const out = transcript('Libera', '#general', messages)
    expect(out).toContain('# #general on Libera')
    expect(out).toContain('# 3 messages')
    expect(out).toContain('# 2026-09-10 to 2026-09-11')
  })

  /** A month of scrollback is a wall of timestamps without them */
  it('marks each day', () => {
    const out = transcript('Libera', '#general', messages)
    expect(out).toContain('--- 2026-09-10 ---')
    expect(out).toContain('--- 2026-09-11 ---')
  })

  it('keeps the messages in order', () => {
    const out = transcript('Libera', '#general', messages).split('\n')
    const said = out.filter((line) => line.includes('<'))
    expect(said[0]).toContain('morning')
    expect(said[1]).toContain('hello')
    expect(said[2]).toContain('still here')
  })

  it('handles a conversation with nothing in it', () => {
    const out = transcript('Libera', '#empty', [])
    expect(out).toContain('# 0 messages')
    expect(out).not.toContain('---')
  })

  it('counts one message as one', () => {
    expect(transcript('n', '#c', [messages[0]])).toContain('# 1 message\n')
  })
})

describe('what to call the file', () => {
  for (const c of corpus.files) {
    it(c.name, () => expect(transcriptFilename(c.network, c.channel)).toBe(c.file))
  }

  /**
   * A filename is handed to the operating system. Anything that could walk out
   * of the directory it was meant for has to be gone, not merely unusual.
   */
  it('cannot be made to escape a directory', () => {
    for (const channel of ['../../etc/passwd', '..', './x', 'a\\b']) {
      const name = transcriptFilename('net', channel)
      expect(name).not.toContain('/')
      expect(name).not.toContain('\\')
      expect(name.includes('..')).toBe(false)
    }
  })
})
