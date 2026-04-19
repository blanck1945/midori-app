import { NextResponse } from 'next/server'
import { queryOne } from '../../lib/db'

export async function GET() {
  const row = await queryOne<{ now: string }>('SELECT datetime(\'now\') AS now')
  return NextResponse.json({ ok: true, dbTime: row?.now })
}
