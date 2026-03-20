declare module 'sql.js' {
  interface SqlJsStatic {
    Database: new (data?: ArrayLike<number> | Buffer | null) => Database
  }

  interface Database {
    run(sql: string, params?: unknown[]): Database
    exec(sql: string, params?: unknown[]): QueryExecResult[]
    getRowsModified(): number
    export(): Uint8Array
    close(): void
    prepare(sql: string): Statement
  }

  interface Statement {
    bind(params?: unknown[]): boolean
    step(): boolean
    getAsObject(params?: Record<string, unknown>): Record<string, unknown>
    get(params?: unknown[]): unknown[]
    free(): boolean
    reset(): void
  }

  interface QueryExecResult {
    columns: string[]
    values: unknown[][]
  }

  interface SqlJsConfig {
    locateFile?: (filename: string) => string
  }

  export default function initSqlJs(config?: SqlJsConfig): Promise<SqlJsStatic>
  export { Database, SqlJsStatic, QueryExecResult, Statement }
}
