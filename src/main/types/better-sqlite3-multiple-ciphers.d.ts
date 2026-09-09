/**
 * The package ships types, but behind an `exports` map TypeScript will not
 * follow under this module resolution. Only what the driver uses is declared
 * here — a full copy of the upstream types would rot silently.
 */
declare module 'better-sqlite3-multiple-ciphers' {
  interface RunResult {
    changes: number
    lastInsertRowid: number | bigint
  }

  interface ColumnDefinition {
    name: string
    column: string | null
    table: string | null
    database: string | null
    type: string | null
  }

  interface Statement {
    readonly reader: boolean
    run(...params: unknown[]): RunResult
    get(...params: unknown[]): unknown
    all(...params: unknown[]): unknown[]
    raw(toggle?: boolean): Statement
    columns(): ColumnDefinition[]
  }

  class Database {
    constructor(filename: string, options?: Record<string, unknown>)
    prepare(sql: string): Statement
    exec(sql: string): Database
    pragma(sql: string, options?: Record<string, unknown>): unknown
    transaction<T extends (...args: never[]) => unknown>(fn: T): T
    close(): void
    readonly open: boolean
    readonly name: string
  }

  namespace Database {
    export type Database = InstanceType<typeof Database>
  }

  export = Database
}
