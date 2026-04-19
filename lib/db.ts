import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  createClient,
  type Client,
  type InArgs,
  type ResultSet,
  type Transaction,
} from '@libsql/client'
import { config } from './config'

export type SqlRow = Record<string, unknown>

function ensureDir(filePath: string) {
  const dir = path.dirname(filePath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

function resolveDatabaseUrl(): string {
  const fromEnv = config.tursoDatabaseUrl.trim()
  if (fromEnv) return fromEnv
  const abs = path.resolve(process.cwd(), config.databasePath)
  ensureDir(abs)
  return pathToFileURL(abs).href
}

let _client: Client | null = null
let _ready: Promise<void> | null = null

function getRawClient(): Client {
  if (!_client) {
    _client = createClient({
      url: resolveDatabaseUrl(),
      authToken: config.tursoAuthToken.trim() || undefined,
      /** `bigint` rompe `JSON.stringify` / `NextResponse.json` en filas con INTEGER (p. ej. priority). */
      intMode: 'number',
    })
  }
  return _client
}

async function ensureInitialized(): Promise<void> {
  if (!_ready) {
    _ready = (async () => {
      const client = getRawClient()
      await client.execute('PRAGMA foreign_keys = ON')
      if (client.protocol === 'file') {
        await client.execute('PRAGMA journal_mode = WAL')
      }
      if (config.applySchemaOnStartup) {
        const schemaPath = path.resolve(process.cwd(), 'lib/sql/schema.sql')
        const schemaSql = fs.readFileSync(schemaPath, 'utf8')
        await client.executeMultiple(schemaSql)
      }
    })()
  }
  await _ready
}

/** Cliente libSQL tras aplicar pragmas y esquema (si aplica). */
export async function getDb(): Promise<Client> {
  await ensureInitialized()
  return getRawClient()
}

/** Útil para `RETURNING` y SELECT dentro de una transacción interactiva. */
export function rowsFromResultSet<T extends SqlRow>(rs: ResultSet): T[] {
  return rs.rows.map((row) => {
    const rec: SqlRow = {}
    for (const col of rs.columns) {
      rec[col] = (row as Record<string, unknown>)[col]
    }
    return rec as T
  })
}

export async function queryAll<T extends SqlRow = SqlRow>(sql: string, params: InArgs = []): Promise<T[]> {
  await ensureInitialized()
  const rs = await getRawClient().execute({ sql, args: params })
  return rowsFromResultSet<T>(rs)
}

export async function queryOne<T extends SqlRow = SqlRow>(
  sql: string,
  params: InArgs = [],
): Promise<T | undefined> {
  const rows = await queryAll<T>(sql, params)
  return rows[0]
}

export async function run(
  sql: string,
  params: InArgs = [],
): Promise<{ changes: number; lastInsertRowid: bigint }> {
  await ensureInitialized()
  const rs = await getRawClient().execute({ sql, args: params })
  const lid = rs.lastInsertRowid
  return {
    changes: rs.rowsAffected,
    lastInsertRowid: lid !== undefined ? BigInt(lid) : 0n,
  }
}

export async function withTransaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  await ensureInitialized()
  const client = getRawClient()
  const tx = await client.transaction('write')
  try {
    const result = await fn(tx)
    await tx.commit()
    return result
  } catch (e) {
    await tx.rollback()
    throw e
  } finally {
    tx.close()
  }
}

export type { Transaction }
