import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { config } from './config'

let _db: Database.Database | null = null

function ensureDir(filePath: string) {
  const dir = path.dirname(filePath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

export function getDb(): Database.Database {
  if (_db) return _db
  ensureDir(config.databasePath)
  _db = new Database(config.databasePath)
  _db.pragma('journal_mode = WAL')
  _db.pragma('foreign_keys = ON')
  const schemaPath = path.resolve(process.cwd(), 'lib/sql/schema.sql')
  const schemaSql = fs.readFileSync(schemaPath, 'utf8')
  _db.exec(schemaSql)
  return _db
}

export type SqlRow = Record<string, unknown>

export function queryAll<T extends SqlRow = SqlRow>(sql: string, params: unknown[] = []): T[] {
  const db = getDb()
  return db.prepare(sql).all(...params) as T[]
}

export function queryOne<T extends SqlRow = SqlRow>(sql: string, params: unknown[] = []): T | undefined {
  const db = getDb()
  return db.prepare(sql).get(...params) as T | undefined
}

export function run(sql: string, params: unknown[] = []): { changes: number; lastInsertRowid: bigint } {
  const db = getDb()
  const info = db.prepare(sql).run(...params)
  return { changes: info.changes, lastInsertRowid: BigInt(info.lastInsertRowid) }
}

export function withTransaction<T>(fn: (db: Database.Database) => T): T {
  const db = getDb()
  return db.transaction(() => fn(db))()
}
