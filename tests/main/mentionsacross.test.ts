import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

/**
 * Finding what named you in what is already stored.
 *
 * The badge counts mentions as they arrive and then forgets which lines they
 * were, so this reads them back out of the database instead. Two passes: SQL
 * narrows to lines with the text in them somewhere, `mentionsYou` decides —
 * and it is the second one that has to be trusted, because the first says yes
 * to "karaoke" for a nick of "kara".
 */

let userData: string

vi.mock('electron', () => ({
  app: { getPath: () => userData },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(`wrapped:${value}`),
    decryptString: (buffer: Buffer) => buffer.toString().replace(/^wrapped:/, '')
  }
}))

beforeEach(() => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'switchboard-mentions-'))
  vi.resetModules()
})

afterEach(() => {
  fs.rmSync(userData, { recursive: true, force: true })
})

/** A database with one network and whatever was said on it */
async function withSaid(
  said: Array<{ nick: string; content: string; channel?: string; type?: string; at?: string }>
): Promise<typeof import('../../src/main/storage/models/message')> {
  const platform = await import('../../src/main/host')
  platform.setHost(platform.testHost(userData, { keychain: true }))

  const database = await import('../../src/main/storage/database')
  await database.initDatabase()

  const db = database.getDb()
  db.run("INSERT INTO servers (id, name, host, port, nick) VALUES ('s1', 'tiny', 'localhost', 6667, 'kara')")

  said.forEach((line, at) => {
    db.run(
      `INSERT INTO messages (id, server_id, channel, nick, content, type, timestamp)
       VALUES (?, 's1', ?, ?, ?, ?, ?)`,
      [
        `m${at}`,
        line.channel ?? '#lobby',
        line.nick,
        line.content,
        line.type ?? 'privmsg',
        line.at ?? `2026-09-15T10:0${at}:00.000Z`
      ]
    )
  })

  return import('../../src/main/storage/models/message')
}

describe('everything that named you', () => {
  it('finds the line that used your nick', async () => {
    const { mentionsOn } = await withSaid([
      { nick: 'rowan', content: 'kara: the tags are up' },
      { nick: 'sam', content: 'nothing to do with anyone' }
    ])

    const found = mentionsOn('s1', 'kara', [])
    expect(found.map((m) => m.nick)).toEqual(['rowan'])
  })

  it('leaves your nick inside a longer word alone', async () => {
    // The whole reason SQL is not allowed to decide on its own: `LIKE
    // '%kara%'` says yes to this, and a mentions list full of karaoke is a
    // mentions list nobody reads twice.
    const { mentionsOn } = await withSaid([
      { nick: 'jo', content: 'karaoke later, everyone welcome' }
    ])

    expect(mentionsOn('s1', 'kara', [])).toEqual([])
  })

  it('finds a highlight word as readily as a nick', async () => {
    const { mentionsOn } = await withSaid([
      { nick: 'sam', content: 'anything on the switchboard release?' }
    ])

    expect(mentionsOn('s1', 'kara', ['switchboard']).map((m) => m.nick)).toEqual(['sam'])
  })

  it('reads a notice too, because a bot answering you is still to you', async () => {
    const { mentionsOn } = await withSaid([
      { nick: 'helper', content: 'kara: your build finished', type: 'notice' }
    ])

    expect(mentionsOn('s1', 'kara', []).map((m) => m.type)).toEqual(['notice'])
  })

  it('does not go looking when there is nothing to look for', async () => {
    // No nick and no words is not "match everything"
    const { mentionsOn } = await withSaid([{ nick: 'sam', content: 'kara: hello' }])

    expect(mentionsOn('s1', '', [])).toEqual([])
  })

  it('gives the newest first, and no more than asked for', async () => {
    const { mentionsOn } = await withSaid([
      { nick: 'a', content: 'kara: first' },
      { nick: 'b', content: 'kara: second' },
      { nick: 'c', content: 'kara: third' }
    ])

    expect(mentionsOn('s1', 'kara', [], 2).map((m) => m.nick)).toEqual(['c', 'b'])
  })

  it('takes a percent sign as a percent sign', async () => {
    // A highlight word is ordinary text, not a LIKE pattern — one containing
    // `%` used to match every line on the network
    const { mentionsOn } = await withSaid([
      { nick: 'sam', content: 'nothing here at all' },
      { nick: 'jo', content: 'we are at 100% capacity' }
    ])

    expect(mentionsOn('s1', 'kara', ['100%']).map((m) => m.nick)).toEqual(['jo'])
  })
})
