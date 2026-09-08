import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

/**
 * Saving the database.
 *
 * sql.js keeps everything in memory and rewrites the whole file on every save —
 * which happens on every message. A truncating write there means any crash or
 * power cut can take the user's servers, their credentials and their history
 * with it, so the write has to be atomic and there has to be a way back.
 */

let userData: string

vi.mock('electron', () => ({
  app: { getPath: () => userData }
}))

beforeEach(() => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'switchboard-db-'))
  vi.resetModules()
})

afterEach(() => {
  fs.rmSync(userData, { recursive: true, force: true })
})

const dbFile = () => path.join(userData, 'switchboard.db')

async function freshDatabase() {
  const module = await import('../../src/main/storage/database')
  await module.initDatabase()
  return module
}

describe('persisting the database', () => {
  it('round-trips through a save and a reopen', async () => {
    const first = await freshDatabase()
    first.getDb().run("CREATE TABLE t (v TEXT); INSERT INTO t VALUES ('kept')")
    first.saveDatabase()

    vi.resetModules()
    const second = await freshDatabase()
    expect(second.getDb().exec('SELECT v FROM t')[0].values[0][0]).toBe('kept')
  })

  it('never leaves a half-written file where the database should be', async () => {
    const module = await freshDatabase()
    module.getDb().run("CREATE TABLE t (v TEXT); INSERT INTO t VALUES ('one')")
    module.saveDatabase()

    const afterFirst = fs.readFileSync(dbFile())

    // Make the new copy impossible to write, standing in for a crash or a full
    // disk part-way through a save
    fs.mkdirSync(`${dbFile()}.tmp`)

    module.getDb().run("INSERT INTO t VALUES ('two')")
    expect(() => module.saveDatabase()).toThrow()

    // The real file is still the one from before, and still opens
    expect(fs.readFileSync(dbFile())).toEqual(afterFirst)
    fs.rmdirSync(`${dbFile()}.tmp`)

    vi.resetModules()
    const reopened = await freshDatabase()
    expect(reopened.getDb().exec('SELECT v FROM t')[0].values.flat()).toEqual(['one'])
  })

  it('keeps the previous copy alongside the new one', async () => {
    const module = await freshDatabase()
    module.getDb().run("CREATE TABLE t (v TEXT); INSERT INTO t VALUES ('one')")
    module.saveDatabase()
    module.getDb().run("INSERT INTO t VALUES ('two')")
    module.saveDatabase()

    expect(fs.existsSync(`${dbFile()}.bak`)).toBe(true)
  })

  it('recovers from the backup when the main file is unreadable', async () => {
    const first = await freshDatabase()
    first.getDb().run("CREATE TABLE t (v TEXT); INSERT INTO t VALUES ('survives')")
    first.saveDatabase()
    first.getDb().run("INSERT INTO t VALUES ('later')")
    first.saveDatabase()

    // What a kill during the old truncating write left behind
    fs.writeFileSync(dbFile(), Buffer.alloc(64))

    vi.resetModules()
    const second = await freshDatabase()
    const rows = second.getDb().exec('SELECT v FROM t')[0].values.flat()
    expect(rows).toContain('survives')
  })

  it('starts fresh rather than throwing when nothing is readable', async () => {
    const first = await freshDatabase()
    first.saveDatabase()

    fs.writeFileSync(dbFile(), Buffer.alloc(64))
    fs.writeFileSync(`${dbFile()}.bak`, Buffer.alloc(64))

    vi.resetModules()
    const second = await freshDatabase()
    expect(second.getDb()).toBeTruthy()
  })
})

/**
 * Edits that survive a restart.
 *
 * `draft/message-edit` changed the text in the running client and nowhere else,
 * so closing the app silently reverted every correction anyone had made — and
 * the phone, which reads the desktop's database, reverted with it.
 */
describe('editing a stored message', () => {
  async function withOneMessage() {
    const db = await freshDatabase()
    const servers = await import('../../src/main/storage/models/server')
    const messages = await import('../../src/main/storage/models/message')

    const serverId = servers.addServer({
      name: 'Test',
      host: 'irc.test',
      port: 6697,
      tls: true,
      password: null,
      nick: 'me',
      username: 'me',
      realname: 'me',
      saslMechanism: null,
      saslUsername: null,
      saslPassword: null,
      autoConnect: false,
      autoJoin: []
    } as never)

    messages.storeMessage({
      id: 'm1',
      serverId,
      channel: '#lounge',
      nick: 'me',
      userHost: null,
      content: 'teh typo',
      type: 'privmsg',
      tags: {},
      replyTo: null,
      timestamp: '2026-09-08T12:00:00Z',
      account: null,
      channelContext: null
    } as never)

    return { db, messages, serverId }
  }

  it('keeps the new text and when it changed', async () => {
    const { messages, serverId } = await withOneMessage()

    expect(messages.editStoredMessage('m1', 'the typo', '2026-09-08T12:05:00Z')).toBe(true)

    const [stored] = messages.getMessages(serverId, '#lounge')
    expect(stored.content).toBe('the typo')
    expect(stored.editedAt).toBe('2026-09-08T12:05:00Z')
  })

  it('says so when the original was never stored', async () => {
    const { messages } = await withOneMessage()

    expect(messages.editStoredMessage('never-seen', 'whatever', '2026-09-08T12:05:00Z')).toBe(false)
  })

  it('leaves an unedited message unmarked', async () => {
    const { messages, serverId } = await withOneMessage()

    const [stored] = messages.getMessages(serverId, '#lounge')
    expect(stored.editedAt).toBeUndefined()
  })
})

/**
 * Reactions that outlive the window.
 *
 * They lived only in the renderer, so every reaction anyone left — including
 * your own, on your own messages — was gone at the next restart.
 */
describe('keeping reactions', () => {
  async function withOneMessage() {
    await freshDatabase()
    const servers = await import('../../src/main/storage/models/server')
    const messages = await import('../../src/main/storage/models/message')
    const reactions = await import('../../src/main/storage/models/reaction')

    const serverId = servers.addServer({
      name: 'Test',
      host: 'irc.test',
      port: 6697,
      tls: true,
      password: null,
      nick: 'me',
      username: 'me',
      realname: 'me',
      saslMechanism: null,
      saslUsername: null,
      saslPassword: null,
      autoConnect: false,
      autoJoin: []
    } as never)

    messages.storeMessage({
      id: 'm1',
      serverId,
      channel: '#lounge',
      nick: 'robin',
      userHost: null,
      content: 'ship it',
      type: 'privmsg',
      tags: {},
      replyTo: null,
      timestamp: '2026-09-08T12:00:00Z',
      account: null,
      channelContext: null
    } as never)

    return { serverId, messages, reactions }
  }

  it('gives a message back its reactions', async () => {
    const { serverId, messages, reactions } = await withOneMessage()

    reactions.setReaction(serverId, '#lounge', 'm1', '👍', 'kara', false)
    reactions.setReaction(serverId, '#lounge', 'm1', '👍', 'jules', false)
    reactions.setReaction(serverId, '#lounge', 'm1', '🔥', 'kara', false)

    const [stored] = messages.getMessages(serverId, '#lounge')
    expect(stored.reactions['👍'].sort()).toEqual(['jules', 'kara'])
    expect(stored.reactions['🔥']).toEqual(['kara'])
  })

  it('takes one back without disturbing the others', async () => {
    const { serverId, messages, reactions } = await withOneMessage()

    reactions.setReaction(serverId, '#lounge', 'm1', '👍', 'kara', false)
    reactions.setReaction(serverId, '#lounge', 'm1', '👍', 'jules', false)
    reactions.setReaction(serverId, '#lounge', 'm1', '👍', 'kara', true)

    const [stored] = messages.getMessages(serverId, '#lounge')
    expect(stored.reactions['👍']).toEqual(['jules'])
  })

  it('does not count the same person twice', async () => {
    const { serverId, messages, reactions } = await withOneMessage()

    reactions.setReaction(serverId, '#lounge', 'm1', '👍', 'kara', false)
    reactions.setReaction(serverId, '#lounge', 'm1', '👍', 'kara', false)

    const [stored] = messages.getMessages(serverId, '#lounge')
    expect(stored.reactions['👍']).toEqual(['kara'])
  })

  it('leaves a message with no reactions alone', async () => {
    const { serverId, messages } = await withOneMessage()

    const [stored] = messages.getMessages(serverId, '#lounge')
    expect(stored.reactions).toEqual({})
  })

  it('forgets them when the message is taken back', async () => {
    const { serverId, messages, reactions } = await withOneMessage()

    reactions.setReaction(serverId, '#lounge', 'm1', '👍', 'kara', false)
    messages.deleteMessage('m1')

    expect(reactions.reactionsFor(serverId, '#lounge', ['m1'])).toEqual({})
  })
})

