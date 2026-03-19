import initSqlJs, { type Database as SqlJsDatabase } from 'sql.js'
import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'

let db: SqlJsDatabase | null = null
let dbPath: string

/**
 * Initialize the SQLite database using sql.js (pure JS SQLite).
 * Creates the database file in the user's app data directory.
 */
export async function initDatabase(): Promise<void> {
  const SQL = await initSqlJs()

  dbPath = path.join(app.getPath('userData'), 'switchboard.db')

  // Load existing database or create new
  if (fs.existsSync(dbPath)) {
    const buffer = fs.readFileSync(dbPath)
    db = new SQL.Database(buffer)
  } else {
    db = new SQL.Database()
  }

  // Run migrations
  runMigrations()

  // Enable WAL mode for better concurrent access
  db.run('PRAGMA journal_mode = WAL')
  db.run('PRAGMA foreign_keys = ON')
}

/**
 * Get the database instance. Throws if not initialized.
 */
export function getDb(): SqlJsDatabase {
  if (!db) throw new Error('Database not initialized')
  return db
}

/**
 * Save the database to disk.
 * sql.js is in-memory, so we need to explicitly save.
 */
export function saveDatabase(): void {
  if (!db) return
  const data = db.export()
  const buffer = Buffer.from(data)
  fs.writeFileSync(dbPath, buffer)
}

/**
 * Close and save the database.
 */
export function closeDatabase(): void {
  if (db) {
    saveDatabase()
    db.close()
    db = null
  }
}

/**
 * Run database migrations.
 */
function runMigrations(): void {
  if (!db) return

  // Create migrations tracking table
  db.run(`
    CREATE TABLE IF NOT EXISTS migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)

  const applied = new Set<string>()
  const rows = db.exec('SELECT name FROM migrations')
  if (rows.length > 0) {
    for (const row of rows[0].values) {
      applied.add(row[0] as string)
    }
  }

  // Migration 001: Initial schema
  if (!applied.has('001_initial')) {
    db.run(`
      CREATE TABLE servers (
        id            TEXT PRIMARY KEY,
        name          TEXT NOT NULL,
        host          TEXT NOT NULL,
        port          INTEGER NOT NULL DEFAULT 6697,
        tls           INTEGER NOT NULL DEFAULT 1,
        password      TEXT,
        nick          TEXT NOT NULL,
        username      TEXT,
        realname      TEXT,
        sasl_mechanism TEXT,
        sasl_username TEXT,
        sasl_password TEXT,
        auto_connect  INTEGER NOT NULL DEFAULT 0,
        auto_join     TEXT DEFAULT '[]',
        sort_order    INTEGER NOT NULL DEFAULT 0,
        created_at    TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `)

    db.run(`
      CREATE TABLE sts_policies (
        host          TEXT PRIMARY KEY,
        port          INTEGER NOT NULL,
        duration      INTEGER NOT NULL,
        cached_at     TEXT NOT NULL
      )
    `)

    db.run(`
      CREATE TABLE channels (
        id            TEXT PRIMARY KEY,
        server_id     TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
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

    db.run(`
      CREATE TABLE messages (
        id            TEXT PRIMARY KEY,
        server_id     TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
        channel       TEXT NOT NULL,
        nick          TEXT NOT NULL,
        user_host     TEXT,
        content       TEXT NOT NULL,
        type          TEXT NOT NULL DEFAULT 'privmsg',
        tags          TEXT DEFAULT '{}',
        reply_to      TEXT,
        timestamp     TEXT NOT NULL,
        created_at    TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `)

    db.run('CREATE INDEX idx_messages_channel ON messages(server_id, channel, timestamp)')
    db.run('CREATE INDEX idx_messages_reply ON messages(reply_to)')

    db.run(`
      CREATE TABLE read_markers (
        server_id     TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
        channel       TEXT NOT NULL,
        timestamp     TEXT NOT NULL,
        PRIMARY KEY (server_id, channel)
      )
    `)

    db.run(`
      CREATE TABLE settings (
        key           TEXT PRIMARY KEY,
        value         TEXT NOT NULL
      )
    `)

    db.run("INSERT INTO migrations (name) VALUES ('001_initial')")
  }

  saveDatabase()
}
