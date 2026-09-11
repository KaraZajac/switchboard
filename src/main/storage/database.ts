import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { SqliteDatabase } from './driver'
import { databaseKey, keyPragma } from './key'
import { migrateFromSqlJs } from './migrate'

let db: SqliteDatabase | null = null
let dbPath: string
let encrypted = false

/** Whether what is on disk is encrypted, for Settings to report honestly */
export function databaseIsEncrypted(): boolean {
  return encrypted
}

/**
 * Open the database, migrating and encrypting it if this is the first run.
 *
 * The file is real SQLite now rather than sql.js, which changes three things
 * that mattered: it is encrypted page by page with a key the OS keychain
 * holds; writes reach the disk as they happen instead of the whole database
 * being serialised after every message; and full-text search exists, so
 * message search can stop being a substring scan.
 */
export async function initDatabase(): Promise<void> {
  const userData = app.getPath('userData')
  dbPath = path.join(userData, 'switchboard.sqlite')
  const legacyPath = path.join(userData, 'switchboard.db')

  const key = databaseKey()
  encrypted = key !== null

  if (!encrypted) {
    // No keyring — common on headless boxes and minimal desktops. Carrying on
    // unencrypted is the right call: refusing to start would lose someone
    // their client over a missing daemon, and the alternative of writing the
    // key out in the clear beside the database it unlocks protects nobody.
    console.warn(
      'No OS keychain available, so the database is not encrypted. ' +
        'Settings → Network reports this.'
    )
  }

  const fresh = !fs.existsSync(dbPath)
  db = new SqliteDatabase(dbPath, key ? keyPragma(key) : null)

  // The one-time move out of sql.js. Only into an empty database, and the old
  // file is left alone until a later run has proved this one opens.
  if (fresh && fs.existsSync(legacyPath)) {
    try {
      const result = await migrateFromSqlJs(legacyPath, db)
      if (result.migrated) {
        console.info(
          `Moved ${result.rows} rows across ${result.tables} tables into the ` +
            (encrypted ? 'encrypted database' : 'new database')
        )
        fs.renameSync(legacyPath, `${legacyPath}.migrated`)
      }
    } catch (err) {
      // Leave the old database exactly where it is and start clean rather than
      // carry on writing into a half-filled one.
      console.error('Could not migrate the old database:', err)
      db.close()
      fs.rmSync(dbPath, { force: true })
      db = new SqliteDatabase(dbPath, key ? keyPragma(key) : null)
    }
  }

  runMigrations()
}

/**
 * Get the database instance. Throws if not initialized.
 */
export function getDb(): SqliteDatabase {
  if (!db) throw new Error('Database not initialized')
  return db
}

/**
 * Close the database.
 *
 * This checkpoints the write-ahead log and removes it, which is the only part
 * of shutdown that still matters — everything written before now is already on
 * disk. There is no save: sql.js held the whole database in memory and had to
 * be serialised out after every message, and that is what has been left behind.
 */
export function closeDatabase(): void {
  if (db) {
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

  // Migration 002: FTS5 for message search
  if (!applied.has('002_fts_search')) {
    try {
      db.run(`
        CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
          id UNINDEXED,
          server_id UNINDEXED,
          channel UNINDEXED,
          nick,
          content,
          timestamp UNINDEXED,
          content='messages',
          content_rowid='rowid'
        )
      `)

      // Triggers to keep FTS in sync with messages table
      db.run(`
        CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
          INSERT INTO messages_fts(rowid, id, server_id, channel, nick, content, timestamp)
          VALUES (new.rowid, new.id, new.server_id, new.channel, new.nick, new.content, new.timestamp);
        END
      `)

      db.run(`
        CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
          INSERT INTO messages_fts(messages_fts, rowid, id, server_id, channel, nick, content, timestamp)
          VALUES ('delete', old.rowid, old.id, old.server_id, old.channel, old.nick, old.content, old.timestamp);
        END
      `)

      // Populate FTS from existing messages
      db.run(`INSERT INTO messages_fts(rowid, id, server_id, channel, nick, content, timestamp)
              SELECT rowid, id, server_id, channel, nick, content, timestamp FROM messages`)

      db.run("INSERT INTO migrations (name) VALUES ('002_fts_search')")
    } catch {
      // sql.js is built without FTS5. Search falls back to LIKE matching in
      // searchMessages(), so this is not fatal — just note it once per launch.
      console.info('SQLite has no FTS5 module — message search uses substring matching')
    }
  }

  // Migration 003: Add websocket_url column to servers
  if (!applied.has('003_websocket_url')) {
    db.run('ALTER TABLE servers ADD COLUMN websocket_url TEXT DEFAULT NULL')
    db.run("INSERT INTO migrations (name) VALUES ('003_websocket_url')")
  }

  // Migration 004: Add identify_command column to servers
  if (!applied.has('004_identify_command')) {
    db.run('ALTER TABLE servers ADD COLUMN identify_command TEXT DEFAULT NULL')
    db.run("INSERT INTO migrations (name) VALUES ('004_identify_command')")
  }

  // Migration 005: Add avatar_url column to servers
  if (!applied.has('005_avatar_url')) {
    db.run('ALTER TABLE servers ADD COLUMN avatar_url TEXT DEFAULT NULL')
    db.run("INSERT INTO migrations (name) VALUES ('005_avatar_url')")
  }

  // Migration 007: Add pre_away_message column to servers
  if (!applied.has('007_pre_away_message')) {
    db.run('ALTER TABLE servers ADD COLUMN pre_away_message TEXT DEFAULT NULL')
    db.run("INSERT INTO migrations (name) VALUES ('007_pre_away_message')")
  }

  // Migration 006: Monitor (friend) list
  if (!applied.has('006_monitor_list')) {
    db.run(`
      CREATE TABLE monitor_list (
        server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
        nick TEXT NOT NULL,
        PRIMARY KEY (server_id, nick)
      )
    `)
    db.run("INSERT INTO migrations (name) VALUES ('006_monitor_list')")
  }

  // Migration 009: Profile metadata (IRCv3 draft/metadata-2) per server
  if (!applied.has('009_profile_metadata')) {
    db.run('ALTER TABLE servers ADD COLUMN profile_metadata TEXT DEFAULT NULL')
    // The avatar used to live in its own column; keep it by moving it in
    db.run(
      `UPDATE servers SET profile_metadata = json_object('avatar', avatar_url)
       WHERE avatar_url IS NOT NULL AND avatar_url != ''`
    )
    db.run("INSERT INTO migrations (name) VALUES ('009_profile_metadata')")
  }

  // Migration 011: Keep reactions
  //
  // They lived in the renderer and nowhere else, so every reaction anyone left
  // was gone at the next restart — including your own, on your own messages.
  if (!applied.has('011_reactions')) {
    db.run(`
      CREATE TABLE reactions (
        server_id TEXT NOT NULL,
        channel   TEXT NOT NULL,
        msgid     TEXT NOT NULL,
        emoji     TEXT NOT NULL,
        nick      TEXT NOT NULL,
        PRIMARY KEY (server_id, channel, msgid, emoji, nick)
      )
    `)
    db.run('CREATE INDEX idx_reactions_message ON reactions(server_id, channel, msgid)')
    db.run("INSERT INTO migrations (name) VALUES ('011_reactions')")
  }

  // Migration 010: Remember that a message was edited
  //
  // draft/message-edit changed the text in the running client and nowhere else,
  // so every edit was undone by the next restart — on the desktop and, through
  // it, on the phone.
  if (!applied.has('010_message_edits')) {
    db.run('ALTER TABLE messages ADD COLUMN edited_at TEXT DEFAULT NULL')
    db.run("INSERT INTO migrations (name) VALUES ('010_message_edits')")
  }

  // Migration 008: Paired devices for the remote link
  if (!applied.has('008_remote_devices')) {
    db.run(`
      CREATE TABLE remote_devices (
        endpoint_id   TEXT PRIMARY KEY,
        name          TEXT NOT NULL,
        paired_at     TEXT NOT NULL DEFAULT (datetime('now')),
        last_seen_at  TEXT
      )
    `)
    db.run("INSERT INTO migrations (name) VALUES ('008_remote_devices')")
  }

  // Migration 012: keep the search index honest when a message is edited.
  //
  // 002 built the index with an insert and a delete trigger, from a time when
  // a message could only ever appear or go away. Edits arrived later, and an
  // external-content FTS5 table does not notice an UPDATE it was not told
  // about: search would go on matching the text that had been replaced, and
  // then show the row as it reads now.
  if (!applied.has('012_fts_edits') && hasFts()) {
    db.run(`
      CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE OF content ON messages BEGIN
        INSERT INTO messages_fts(messages_fts, rowid, id, server_id, channel, nick, content, timestamp)
        VALUES ('delete', old.rowid, old.id, old.server_id, old.channel, old.nick, old.content, old.timestamp);
        INSERT INTO messages_fts(rowid, id, server_id, channel, nick, content, timestamp)
        VALUES (new.rowid, new.id, new.server_id, new.channel, new.nick, new.content, new.timestamp);
      END
    `)
    db.run("INSERT INTO migrations (name) VALUES ('012_fts_edits')")
  }

  // Migration 013: Somewhere to keep a client certificate
  //
  // SASL EXTERNAL was implemented and the server dialog offered it, and there
  // was nowhere to put the certificate it needs — so choosing it presented none
  // and ended in 904. Encrypted like the passwords beside it, because that is
  // what it is.
  if (!applied.has('013_client_cert')) {
    db.run('ALTER TABLE servers ADD COLUMN client_cert TEXT DEFAULT NULL')
    db.run("INSERT INTO migrations (name) VALUES ('013_client_cert')")
  }

  // Lines to send once a network is ready. `identifyCommand` is one such line
  // and has been there all along, but it is exactly one, it is a credential,
  // and it is stripped on the way to a paired device — none of which suits
  // "join these two channels and set +i".
  if (!applied.has('014_perform_on_connect')) {
    db.run('ALTER TABLE servers ADD COLUMN perform_on_connect TEXT DEFAULT NULL')
    db.run("INSERT INTO migrations (name) VALUES ('014_perform_on_connect')")
  }
}

/** Whether the search index exists — it does not on a build without FTS5 */
function hasFts(): boolean {
  if (!db) return false
  const rows = db.exec("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'messages_fts'")
  return rows.length > 0 && rows[0].values.length > 0
}
