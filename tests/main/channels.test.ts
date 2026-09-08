import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'

const state = vi.hoisted(() => ({ db: null as unknown as { run: (...a: unknown[]) => void } }))

vi.mock('../../src/main/storage/database', () => ({
  getDb: () => state.db,
  saveDatabase: () => {}
}))

const { getJoinedChannels, markChannelJoined, markChannelParted } = await import(
  '../../src/main/storage/models/channel'
)

const SERVER = 'server-1'
const OTHER = 'server-2'

beforeAll(async () => {
  const initSqlJs = (await import('sql.js')).default
  const SQL = await initSqlJs()
  state.db = new SQL.Database()
})

beforeEach(() => {
  const db = state.db as unknown as { run: (sql: string) => void }
  db.run('DROP TABLE IF EXISTS channels')
  db.run(`
    CREATE TABLE channels (
      id            TEXT PRIMARY KEY,
      server_id     TEXT NOT NULL,
      name          TEXT NOT NULL,
      topic         TEXT,
      topic_set_by  TEXT,
      topic_set_at  TEXT,
      modes         TEXT DEFAULT '{}',
      joined        INTEGER NOT NULL DEFAULT 0,
      sort_order    INTEGER NOT NULL DEFAULT 0,
      muted         INTEGER NOT NULL DEFAULT 0,
      category      TEXT,
      UNIQUE(server_id, name)
    )
  `)
})

describe('joined channel persistence', () => {
  it('remembers a joined channel', () => {
    markChannelJoined(SERVER, '#general')
    expect(getJoinedChannels(SERVER)).toEqual(['#general'])
  })

  it('keeps channels in join order', () => {
    markChannelJoined(SERVER, '#first')
    markChannelJoined(SERVER, '#second')
    markChannelJoined(SERVER, '#third')
    expect(getJoinedChannels(SERVER)).toEqual(['#first', '#second', '#third'])
  })

  it('does not duplicate a channel joined twice', () => {
    markChannelJoined(SERVER, '#general')
    markChannelJoined(SERVER, '#general')
    expect(getJoinedChannels(SERVER)).toEqual(['#general'])
  })

  it('treats channel names case-insensitively, as IRC does', () => {
    markChannelJoined(SERVER, '#General')
    markChannelJoined(SERVER, '#general')
    expect(getJoinedChannels(SERVER)).toEqual(['#General'])

    markChannelParted(SERVER, '#GENERAL')
    expect(getJoinedChannels(SERVER)).toEqual([])
  })

  it('forgets a channel after parting, and remembers it again on rejoin', () => {
    markChannelJoined(SERVER, '#general')
    markChannelJoined(SERVER, '#other')

    markChannelParted(SERVER, '#general')
    expect(getJoinedChannels(SERVER)).toEqual(['#other'])

    markChannelJoined(SERVER, '#general')
    expect(getJoinedChannels(SERVER)).toEqual(['#general', '#other'])
  })

  it('keeps servers separate', () => {
    markChannelJoined(SERVER, '#mine')
    markChannelJoined(OTHER, '#theirs')

    expect(getJoinedChannels(SERVER)).toEqual(['#mine'])
    expect(getJoinedChannels(OTHER)).toEqual(['#theirs'])
  })

  it('reports nothing for a server with no channels', () => {
    expect(getJoinedChannels('unknown-server')).toEqual([])
  })
})
