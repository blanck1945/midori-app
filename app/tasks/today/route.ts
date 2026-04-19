import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '../../../lib/auth'
import { mapTask } from '../../../lib/mappers'
import { queryAll } from '../../../lib/db'

export async function GET(request: NextRequest) {
  const user = requireUser(request)
  if (!user) return NextResponse.json({ message: 'Token faltante' }, { status: 401 })

  const sql = `
    SELECT t.* FROM care_tasks t
    JOIN plants p ON p.id = t.plant_id
    WHERE p.user_id = ?
      AND t.scheduled_for < datetime('now', 'start of day', '+1 day')
      AND (
        t.status = 'pending'
        OR t.scheduled_for >= datetime('now', 'start of day')
      )
    ORDER BY t.scheduled_for ASC, t.priority DESC
  `
  const rows = await queryAll<Parameters<typeof mapTask>[0]>(sql, [user.id])
  return NextResponse.json(rows.map(mapTask))
}
