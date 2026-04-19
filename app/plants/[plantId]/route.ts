import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '../../../lib/auth'
import { mapDiagnosis, mapPlant, mapPlantPhoto, mapTask } from '../../../lib/mappers'
import { queryAll, queryOne, run } from '../../../lib/db'

type Ctx = { params: Promise<{ plantId: string }> }

export async function GET(request: NextRequest, ctx: Ctx) {
  const user = requireUser(request)
  if (!user) return NextResponse.json({ message: 'Token faltante' }, { status: 401 })

  const { plantId } = await ctx.params
  const plantRow = await queryOne<Parameters<typeof mapPlant>[0]>(
    'SELECT * FROM plants WHERE id = ? AND user_id = ?',
    [plantId, user.id],
  )
  if (!plantRow) {
    return NextResponse.json({ message: 'Planta no encontrada' }, { status: 404 })
  }

  const diagRows = await queryAll<Parameters<typeof mapDiagnosis>[0]>(
    'SELECT * FROM diagnoses WHERE plant_id = ? ORDER BY created_at DESC LIMIT 10',
    [plantId],
  )
  const taskRows = await queryAll<Parameters<typeof mapTask>[0]>(
    `SELECT * FROM care_tasks WHERE plant_id = ?
       AND scheduled_for >= datetime('now', '-7 days')
     ORDER BY scheduled_for ASC`,
    [plantId],
  )

  const photoRows = await queryAll<Parameters<typeof mapPlantPhoto>[0]>(
    `SELECT id, plant_id, image_url, note, context, captured_at
     FROM plant_photos
     WHERE plant_id = ?
     ORDER BY captured_at DESC`,
    [plantId],
  )

  return NextResponse.json({
    plant: mapPlant(plantRow),
    diagnoses: diagRows.map(mapDiagnosis),
    tasks: taskRows.map(mapTask),
    photos: photoRows.map(mapPlantPhoto),
  })
}

export async function DELETE(_request: NextRequest, ctx: Ctx) {
  const user = requireUser(_request)
  if (!user) return NextResponse.json({ message: 'Token faltante' }, { status: 401 })

  const { plantId } = await ctx.params
  const result = await run('DELETE FROM plants WHERE id = ? AND user_id = ?', [plantId, user.id])
  if (result.changes === 0) {
    return NextResponse.json({ message: 'Planta no encontrada' }, { status: 404 })
  }

  return NextResponse.json({ ok: true })
}
