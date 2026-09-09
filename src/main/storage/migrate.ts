import initSqlJs from 'sql.js'
import * as fs from 'fs'
import { SqliteDatabase } from './driver'

/**
 * Moving an existing database into the encrypted one.
 *
 * This runs once, on the launch after an upgrade, and it is the riskiest code
 * in the app: on the other side of it is every message the user has, their
 * server list and their credentials. So it copies rather than converts, checks
 * what it copied, and does not delete anything until the new database has
 * opened cleanly on a later run.
 *
 * The old file is sql.js — the whole database held in memory and rewritten on
 * every save. That is what is being left behind, as much as the plaintext.
 */

export interface MigrationResult {
  migrated: boolean
  tables: number
  rows: number
}

/** Tables SQLite keeps for itself, which must not be copied by hand */
function isInternal(name: string): boolean {
  return name.startsWith('sqlite_')
}

/**
 * Copy everything out of a sql.js database file into an open encrypted one.
 *
 * The destination is assumed empty. Row counts are compared per table
 * afterwards, and a mismatch throws — a migration that half worked is worse
 * than one that refused, because the user would carry on and write into it.
 */
export async function migrateFromSqlJs(
  oldFile: string,
  destination: SqliteDatabase
): Promise<MigrationResult> {
  if (!fs.existsSync(oldFile)) return { migrated: false, tables: 0, rows: 0 }

  const SQL = await initSqlJs()
  const source = new SQL.Database(fs.readFileSync(oldFile))

  try {
    const schema = source.exec(
      "SELECT name, sql FROM sqlite_master WHERE type = 'table' AND sql IS NOT NULL"
    )
    if (schema.length === 0) return { migrated: false, tables: 0, rows: 0 }

    const tables = (schema[0].values as [string, string][]).filter(
      // A virtual table is a view onto something else — an FTS index over the
      // messages table, here — and copying its rows in by hand would corrupt
      // it. It gets rebuilt from the real table by the migrations instead.
      ([name, sql]) => !isInternal(name) && !/^\s*CREATE\s+VIRTUAL/i.test(sql)
    )

    let rows = 0

    // One transaction: either the whole history arrives or none of it does.
    destination.transaction(() => {
      for (const [name, createSql] of tables) {
        destination.run(createSql)

        const contents = source.exec(`SELECT * FROM "${name}"`)
        if (contents.length === 0) continue

        const columns = contents[0].columns
        const placeholders = columns.map(() => '?').join(', ')
        const insert = `INSERT INTO "${name}" (${columns
          .map((c) => `"${c}"`)
          .join(', ')}) VALUES (${placeholders})`

        for (const row of contents[0].values) {
          destination.run(insert, row as unknown[])
          rows++
        }
      }

      // Indexes and triggers after the rows, which is both faster and avoids a
      // trigger firing on data that is only being moved.
      const rest = source.exec(
        "SELECT sql FROM sqlite_master WHERE type IN ('index', 'trigger') AND sql IS NOT NULL"
      )
      for (const statement of rest[0]?.values ?? []) {
        try {
          destination.run(statement[0] as string)
        } catch (err) {
          // An index that will not rebuild is not worth losing the history over
          console.warn('Could not recreate an index during migration:', err)
        }
      }
    })

    // Count what arrived, table by table. A migration that quietly dropped rows
    // is the failure that would not be noticed until somebody went looking for
    // a conversation from last year.
    for (const [name] of tables) {
      const before = source.exec(`SELECT count(*) FROM "${name}"`)[0]?.values[0][0] as number
      const after = destination.exec(`SELECT count(*) AS n FROM "${name}"`)[0]?.values[0][0] as number
      if (before !== after) {
        throw new Error(`Migration lost rows in ${name}: ${before} before, ${after} after`)
      }
    }

    return { migrated: true, tables: tables.length, rows }
  } finally {
    source.close()
  }
}
