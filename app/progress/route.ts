import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '../../lib/auth'
import { mapProgressRow } from '../../lib/services/progressService'
import { queryAll } from '../../lib/db'

export async function GET(request: NextRequest) {
  const user = requireUser(request)
  if (!user) return NextResponse.json({ message: 'Token faltante' }, { status: 401 })

  const sql = `
    SELECT
      p.id AS plant_id,
      COUNT(t.id) FILTER (WHERE t.scheduled_for >= datetime('now', '-7 days')) AS tasks_total_last_7_days,
      COUNT(t.id) FILTER (WHERE t.status = 'done' AND t.scheduled_for >= datetime('now', '-7 days')) AS tasks_done_last_7_days
    FROM plants p
    LEFT JOIN care_tasks t ON t.plant_id = p.id
    WHERE p.user_id = ?
    GROUP BY p.id
    ORDER BY p.created_at DESC
  `
  const rows = queryAll<{
    plant_id: string
    tasks_total_last_7_days: number | null
    tasks_done_last_7_days: number | null
  }>(sql, [user.id])

  return NextResponse.json(rows.map(mapProgressRow))
}
