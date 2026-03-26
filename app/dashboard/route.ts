import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '../../lib/auth'
import { mapPlant, mapTask } from '../../lib/mappers'
import { queryAll } from '../../lib/db'

export async function GET(request: NextRequest) {
  const user = requireUser(request)
  if (!user) return NextResponse.json({ message: 'Token faltante' }, { status: 401 })

  const plantsResult = queryAll<Parameters<typeof mapPlant>[0]>(
    'SELECT * FROM plants WHERE user_id = ? ORDER BY created_at DESC',
    [user.id],
  )

  const dueTasksResult = queryAll<Parameters<typeof mapTask>[0]>(
    `SELECT t.* FROM care_tasks t
     JOIN plants p ON p.id = t.plant_id
     WHERE p.user_id = ?
       AND t.status = 'pending'
       AND t.scheduled_for <= datetime('now', '+48 hours')
     ORDER BY t.scheduled_for ASC`,
    [user.id],
  )

  const criticalResult = queryAll<{ plant_name: string; summary: string }>(
    `SELECT p.name AS plant_name, d.summary
     FROM diagnoses d
     JOIN plants p ON p.id = d.plant_id
     WHERE p.user_id = ?
       AND d.severity = 'high'
       AND d.created_at >= datetime('now', '-7 days')
     ORDER BY d.created_at DESC
     LIMIT 5`,
    [user.id],
  )

  return NextResponse.json({
    plants: plantsResult.map(mapPlant),
    dueTasks: dueTasksResult.map(mapTask),
    criticalAlerts: criticalResult.map((row) => `${row.plant_name}: ${row.summary}`),
  })
}
