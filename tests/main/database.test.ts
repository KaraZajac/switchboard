import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

/**
 * The database on disk.
 *
 * It holds every message the user has, their server list and their passwords,
 * and until this it was a sql.js file: the whole thing in memory, rewritten
 * from scratch after each message, in the clear. What replaced it is real
 * SQLite, encrypted page by page with a key the OS keychain holds, and these
 * are the properties that were bought — that the file is unreadable without
 * the account, that an upgrade brings the old one across intact, and that
 * search works at all.
 */

let userData: string

/**
 * A keychain that works, so the database under test is a real encrypted one.
 * `keychainAvailable` returning false is its own case, below.
 */
let keychain = true

vi.mock('electron', () => ({
  app: { getPath: () => userData },
  safeStorage: {
    isEncryptionAvailable: () => keychain,
    // Not encryption — a stand-in with the same shape, so the wrapping and
    // unwrapping paths are exercised without a real keyring in the test run
    encryptString: (value: string) => Buffer.from(`wrapped:${value}`),
    decryptString: (buffer: Buffer) => buffer.toString().replace(/^wrapped:/, '')
  }
}))

beforeEach(() => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'switchboard-db-'))
  keychain = true
  vi.resetModules()
})

afterEach(() => {
  fs.rmSync(userData, { recursive: true, force: true })
})

const dbFile = () => path.join(userData, 'switchboard.sqlite')
const legacyFile = () => path.join(userData, 'switchboard.db')

async function freshDatabase() {
  const module = await import('../../src/main/storage/database')
  await module.initDatabase()
  return module
}

describe('storing the database', () => {
  it('round-trips through a reopen', async () => {
    const first = await freshDatabase()
    first.getDb().run("CREATE TABLE t (v TEXT); INSERT INTO t VALUES ('kept')")
    first.closeDatabase()

    vi.resetModules()
    const second = await freshDatabase()
    expect(second.getDb().exec('SELECT v FROM t')[0].values[0][0]).toBe('kept')
  })

  it('writes the file encrypted, with no readable text in it', async () => {
    const module = await freshDatabase()
    module.getDb().run("CREATE TABLE t (v TEXT)")
    module.getDb().run('INSERT INTO t VALUES (?)', ['a-distinctive-secret'])
    module.closeDatabase()

    const raw = fs.readFileSync(dbFile())
    expect(module.databaseIsEncrypted()).toBe(true)
    expect(raw.subarray(0, 15).toString()).not.toBe('SQLite format 3')
    expect(raw.includes(Buffer.from('a-distinctive-secret'))).toBe(false)
  })

  it('reopens what it encrypted, using the stored key', async () => {
    const first = await freshDatabase()
    first.getDb().run("CREATE TABLE t (v TEXT)")
    first.getDb().run('INSERT INTO t VALUES (?)', ['kept across a restart'])
    first.closeDatabase()

    vi.resetModules()
    const second = await freshDatabase()
    expect(second.getDb().exec('SELECT v FROM t')[0].values[0][0]).toBe('kept across a restart')
  })

  /**
   * A machine with no keyring — headless boxes, minimal desktops. Refusing to
   * start would lose someone their client over a missing daemon; writing the
   * key out beside the database it unlocks would protect nobody.
   */
  it('still starts when there is no keychain, and says it is not encrypted', async () => {
    keychain = false
    const module = await freshDatabase()

    module.getDb().run("CREATE TABLE t (v TEXT)")
    module.getDb().run('INSERT INTO t VALUES (?)', ['in the clear'])

    expect(module.databaseIsEncrypted()).toBe(false)
    expect(module.getDb().exec('SELECT v FROM t')[0].values[0][0]).toBe('in the clear')
  })

  it('has full-text search, which sql.js did not', async () => {
    const module = await freshDatabase()
    expect(module.getDb().hasFts5()).toBe(true)
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


/**
 * Searching history.
 *
 * Under sql.js there was no FTS5 module, so search was `LIKE '%…%'` over every
 * message ever stored. With a real SQLite there is an index — which brings its
 * own two ways to be wrong: a query someone typed is not query syntax, and an
 * external-content index does not notice an edit unless it is told.
 */
describe('searching history', () => {
  async function withHistory() {
    await freshDatabase()
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

    const said = (id: string, channel: string, content: string, at: string): void =>
      messages.storeMessage({
        id,
        serverId,
        channel,
        nick: 'robin',
        userHost: null,
        content,
        type: 'privmsg',
        tags: {},
        replyTo: null,
        timestamp: at,
        account: null,
        channelContext: null
      } as never)

    said('m1', '#lounge', 'the deploy went out at noon', '2026-09-08T12:00:00Z')
    said('m2', '#dev', 'a well-timed deployment, that', '2026-09-08T12:01:00Z')
    said('m3', '#lounge', 'nothing to do with it', '2026-09-08T12:02:00Z')

    return { messages, serverId }
  }

  it('finds a message by a word in it', async () => {
    const { messages, serverId } = await withHistory()

    const found = messages.searchMessages(serverId, 'noon')
    expect(found.map((m) => m.id)).toEqual(['m1'])
  })

  /** So the results narrow while someone is still typing the word */
  it('matches a word that is only half typed', async () => {
    const { messages, serverId } = await withHistory()

    expect(messages.searchMessages(serverId, 'deplo').map((m) => m.id)).toEqual(['m1', 'm2'])
  })

  /**
   * A hyphen is NOT in FTS5 and a colon names a column. Passing typed text
   * straight through makes the query a syntax error, which arrives as "no
   * results" — the one answer a search must never give wrongly.
   */
  it('does not choke on punctuation someone typed', async () => {
    const { messages, serverId } = await withHistory()

    expect(messages.searchMessages(serverId, 'well-timed').map((m) => m.id)).toEqual(['m2'])
  })

  it('can be held to one channel', async () => {
    const { messages, serverId } = await withHistory()

    const found = messages.searchMessages(serverId, 'deploy', { channel: '#lounge' })
    expect(found.map((m) => m.id)).toEqual(['m1'])
  })

  it('never reaches into another server', async () => {
    const { messages } = await withHistory()

    expect(messages.searchMessages('some-other-server', 'deploy')).toEqual([])
  })

  /** The index is external-content: an UPDATE it is not told about goes stale */
  it('searches the edited text, not the text it replaced', async () => {
    const { messages, serverId } = await withHistory()

    messages.editStoredMessage('m1', 'the rollback went out at midnight', '2026-09-08T12:30:00Z')

    expect(messages.searchMessages(serverId, 'noon')).toEqual([])
    expect(messages.searchMessages(serverId, 'rollback').map((m) => m.id)).toEqual(['m1'])
  })

  it('forgets a deleted message', async () => {
    const { messages, serverId } = await withHistory()

    messages.deleteMessage('m1')

    expect(messages.searchMessages(serverId, 'noon')).toEqual([])
  })
})

/**
 * The one-time move out of sql.js.
 *
 * On the other side of this is every message the user has, their server list
 * and their credentials. It runs once, on the launch after an upgrade, and it
 * has to either bring all of it across or refuse and leave the old file where
 * it was.
 */
describe('migrating an old database', () => {
  /** A sql.js database, exactly as the previous version left one on disk */
  async function legacyDatabase(): Promise<void> {
    const initSqlJs = (await import('sql.js')).default
    const SQL = await initSqlJs()
    const old = new SQL.Database()

    old.run(`
      CREATE TABLE migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT);
      CREATE TABLE servers (id TEXT PRIMARY KEY, name TEXT, host TEXT, sasl_password TEXT);
      CREATE TABLE messages (
        id TEXT PRIMARY KEY, server_id TEXT, channel TEXT, nick TEXT, user_host TEXT,
        content TEXT NOT NULL, type TEXT, tags TEXT, reply_to TEXT, timestamp TEXT
      );
      CREATE INDEX idx_old_messages ON messages(server_id, channel);
      INSERT INTO migrations (name, applied_at) VALUES ('001_initial', '2026-01-01T00:00:00Z');
      INSERT INTO servers VALUES ('s1', 'Doll', 'irc.test', 'hunter2');
      INSERT INTO messages VALUES ('m1', 's1', '#lounge', 'robin', NULL, 'said last year', 'privmsg', '{}', NULL, '2025-06-01T09:00:00Z');
      INSERT INTO messages VALUES ('m2', 's1', '#lounge', 'me', NULL, 'and this too', 'privmsg', '{}', NULL, '2025-06-01T09:01:00Z');
    `)

    fs.writeFileSync(legacyFile(), Buffer.from(old.export()))
    old.close()
  }

  it('brings the history across and leaves the old file behind, renamed', async () => {
    await legacyDatabase()
    const module = await freshDatabase()
    const messages = await import('../../src/main/storage/models/message')

    expect(messages.getMessages('s1', '#lounge').map((m) => m.content)).toEqual([
      'said last year',
      'and this too'
    ])

    // The old file is kept, not deleted — a later run has to prove this one
    // opens before anyone's history is thrown away.
    expect(fs.existsSync(legacyFile())).toBe(false)
    expect(fs.existsSync(`${legacyFile()}.migrated`)).toBe(true)
    expect(module.databaseIsEncrypted()).toBe(true)
  })

  /** What was in the clear before is not, afterwards */
  it('encrypts what the old file held in plaintext', async () => {
    await legacyDatabase()
    expect(fs.readFileSync(legacyFile()).includes(Buffer.from('hunter2'))).toBe(true)

    const module = await freshDatabase()
    module.closeDatabase()

    expect(fs.readFileSync(dbFile()).includes(Buffer.from('hunter2'))).toBe(false)
  })

  /** Migrations already applied stay applied, so 001 does not run over the top */
  it('does not re-run migrations the old database had already applied', async () => {
    await legacyDatabase()
    const module = await freshDatabase()

    const names = module
      .getDb()
      .exec('SELECT name FROM migrations')[0]
      .values.map((row) => row[0])

    expect(names.filter((name) => name === '001_initial')).toHaveLength(1)
  })

  /** Old history is searchable, which under sql.js it never properly was */
  it('indexes what it brought across for search', async () => {
    await legacyDatabase()
    await freshDatabase()
    const messages = await import('../../src/main/storage/models/message')

    expect(messages.searchMessages('s1', 'last year').map((m) => m.id)).toEqual(['m1'])
  })

  it('does nothing on a second launch', async () => {
    await legacyDatabase()
    await freshDatabase()

    vi.resetModules()
    const second = await freshDatabase()
    const messages = await import('../../src/main/storage/models/message')

    expect(messages.getMessages('s1', '#lounge')).toHaveLength(2)
    expect(second.databaseIsEncrypted()).toBe(true)
  })
})
