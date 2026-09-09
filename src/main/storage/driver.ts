import Database from 'better-sqlite3-multiple-ciphers'

/**
 * The database, behind the shape the rest of the app already speaks.
 *
 * This exists to make one change at a time. Moving off sql.js and turning on
 * encryption is already a migration of everybody's history; rewriting eighty
 * call sites in the same commit would make it unreviewable. So the methods
 * here are the ones sql.js offered, over a real SQLite underneath.
 *
 * Two of them — `exec` returning `{ columns, values }`, and the bind/step/free
 * dance of `prepare` — are sql.js's shape rather than a good one, and are the
 * seam to remove next: better-sqlite3 hands back plain objects, which is what
 * the row mappers actually want.
 *
 * What changes immediately, and is the point:
 *
 * - the file is encrypted, page by page, with a key the OS keychain holds;
 * - writes go to disk as they happen rather than the whole database being
 *   serialised and rewritten after every message;
 * - FTS5 exists, so message search can stop being `LIKE '%…%'`.
 */

export interface QueryResult {
  columns: string[]
  values: unknown[][]
}

/** A prepared statement, in the shape the existing callers step through */
export interface Statement {
  bind(params: unknown[]): void
  step(): boolean
  getAsObject(): Record<string, unknown>
  /** Reuse the statement for a write — cheaper than preparing per row */
  run(params: unknown[]): void
  free(): void
}

/**
 * `undefined` is not a value SQLite has, and better-sqlite3 refuses it rather
 * than guess. sql.js bound it as NULL, and every optional column in this
 * schema — `user_host`, `reply_to`, `password` — is written from a field that
 * is legitimately absent, so the guess it made is the one we want. Making it
 * here keeps that out of forty call sites.
 */
function bindable(params: unknown[]): unknown[] {
  return params.map((value) => (value === undefined ? null : value))
}

export class SqliteDatabase {
  private readonly db: Database.Database
  private changes = 0

  constructor(file: string, keyPragma: string | null) {
    this.db = new Database(file)

    // Before anything else touches the file: the key has to be set on a
    // connection before the first read, or SQLite reads the header as
    // plaintext and decides this is not a database.
    if (keyPragma) this.db.pragma(keyPragma)

    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')
  }

  /** Statements with no results: DDL, inserts, updates, pragmas */
  run(sql: string, params: unknown[] = []): void {
    if (params.length === 0) {
      // exec handles several statements in one string, which the schema does
      this.db.exec(sql)
      this.changes = 0
      return
    }
    const result = this.db.prepare(sql).run(...(bindable(params) as never[]))
    this.changes = result.changes
  }

  /** Rows, in sql.js's positional shape */
  exec(sql: string, params: unknown[] = []): QueryResult[] {
    const statement = this.db.prepare(sql)
    const bound = bindable(params)
    if (!statement.reader) {
      const result = statement.run(...(bound as never[]))
      this.changes = result.changes
      return []
    }

    const rows = statement.raw().all(...(bound as never[])) as unknown[][]
    if (rows.length === 0) return []
    return [{ columns: statement.columns().map((column) => column.name), values: rows }]
  }

  prepare(sql: string): Statement {
    const statement = this.db.prepare(sql)
    let rows: Record<string, unknown>[] = []
    let at = -1

    return {
      bind: (params: unknown[]) => {
        const bound = bindable(params)
        rows = statement.reader
          ? (statement.all(...(bound as never[])) as Record<string, unknown>[])
          : []
        if (!statement.reader) this.changes = statement.run(...(bound as never[])).changes
        at = -1
      },
      run: (params: unknown[]) => {
        this.changes = statement.run(...(bindable(params) as never[])).changes
      },
      step: () => ++at < rows.length,
      getAsObject: () => rows[at] ?? {},
      free: () => {
        rows = []
        at = -1
      }
    }
  }

  /** How many rows the last statement changed */
  getRowsModified(): number {
    return this.changes
  }

  /** Whether this build can do full-text search, which sql.js could not */
  hasFts5(): boolean {
    try {
      const row = this.db
        .prepare("SELECT count(*) AS n FROM pragma_compile_options WHERE compile_options = 'ENABLE_FTS5'")
        .get() as { n: number }
      return row.n > 0
    } catch {
      return false
    }
  }

  /** Run several statements as one, so a half-applied migration cannot happen */
  transaction<T>(work: () => T): T {
    return this.db.transaction(work)()
  }

  close(): void {
    this.db.close()
  }
}
