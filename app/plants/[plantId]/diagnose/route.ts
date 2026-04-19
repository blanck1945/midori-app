import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireUser } from '../../../../lib/auth'
import { getDb, queryOne, rowsFromResultSet } from '../../../../lib/db'
import { mapDiagnosis, mapTask } from '../../../../lib/mappers'
import { buildCareTasksFromDiagnosis } from '../../../../lib/services/carePlanService'
import { generateDiagnosis } from '../../../../lib/services/diagnosisService'
import { MAX_PLANT_PHOTOS } from '../../../../lib/constants'
import { getPlantPhotoCount } from '../../../../lib/plantPhoto'
import { queueNotificationsForUpcomingTasks } from '../../../../lib/services/schedulerService'
import { uploadImageFromDataUrl } from '../../../../lib/services/storageService'

const diagnoseSchema = z.object({
  imageUrl: z.string().min(10),
  note: z.string().optional(),
  context: z.string().min(5),
  language: z.enum(['es', 'en', 'pt']).optional().default('es'),
})

type Ctx = { params: Promise<{ plantId: string }> }

export async function POST(request: NextRequest, ctx: Ctx) {
  const user = requireUser(request)
  if (!user) return NextResponse.json({ message: 'Token faltante' }, { status: 401 })

  try {
    const payload = diagnoseSchema.parse(await request.json())
    const { plantId } = await ctx.params

    const plantRow = await queryOne<{
      id: string
      name: string
      species_guess: string
      location: string
      light_level: string
    }>('SELECT * FROM plants WHERE id = ? AND user_id = ?', [plantId, user.id])

    if (!plantRow) {
      return NextResponse.json({ message: 'Planta no encontrada' }, { status: 404 })
    }

    if ((await getPlantPhotoCount(plantId)) >= MAX_PLANT_PHOTOS) {
      return NextResponse.json(
        { message: `Máximo ${MAX_PLANT_PHOTOS} fotos por planta` },
        { status: 409 },
      )
    }

    let storedImageUrl = payload.imageUrl
    if (payload.imageUrl.startsWith('data:')) {
      const key = `plants/${plantRow.id}/${Date.now()}.jpg`
      try {
        storedImageUrl = await uploadImageFromDataUrl(payload.imageUrl, key)
      } catch (err) {
        console.warn('R2 upload failed, storing data URL as fallback:', (err as Error).message)
      }
    }

    const diagnosisData = await generateDiagnosis({
      context: payload.context,
      note: payload.note,
      imageUrl: payload.imageUrl,
      plant: {
        name: plantRow.name,
        species_guess: plantRow.species_guess,
        location: plantRow.location,
        light_level: plantRow.light_level,
      },
      language: payload.language,
    })

    const taskDrafts = await buildCareTasksFromDiagnosis(
      diagnosisData,
      {
        id: plantRow.id,
        name: plantRow.name,
        species_guess: plantRow.species_guess,
        location: plantRow.location,
        light_level: plantRow.light_level,
      },
      payload.language,
    )

    const db = await getDb()
    const tx = await db.transaction('write')
    let txResult!: {
      diagnosis: Parameters<typeof mapDiagnosis>[0]
      generatedTasks: Parameters<typeof mapTask>[0][]
    }
    try {
      const photoId = randomUUID()
      await tx.execute({
        sql: `INSERT INTO plant_photos (id, plant_id, image_url, note, context)
         VALUES (?, ?, ?, ?, ?)`,
        args: [photoId, plantRow.id, storedImageUrl, payload.note ?? null, payload.context],
      })

      const diagnosisId = randomUUID()
      await tx.execute({
        sql: `INSERT INTO diagnoses
         (id, plant_id, photo_id, severity, confidence, summary, detected_issues, recommendations, raw_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          diagnosisId,
          plantRow.id,
          photoId,
          diagnosisData.severity,
          diagnosisData.confidence,
          diagnosisData.summary,
          JSON.stringify(diagnosisData.detectedIssues),
          JSON.stringify(diagnosisData.recommendations),
          JSON.stringify(diagnosisData),
        ],
      })

      await tx.execute({
        sql: `UPDATE care_plans
         SET status = 'archived', ended_at = datetime('now')
         WHERE plant_id = ? AND status = 'active'`,
        args: [plantRow.id],
      })

      const versionRs = await tx.execute({
        sql: 'SELECT COALESCE(MAX(version), 0) + 1 AS next_version FROM care_plans WHERE plant_id = ?',
        args: [plantRow.id],
      })
      const nextVersion = Number(rowsFromResultSet<{ next_version: number }>(versionRs)[0]?.next_version ?? 0)

      const carePlanId = randomUUID()
      await tx.execute({
        sql: `INSERT INTO care_plans (id, plant_id, diagnosis_id, version, status)
         VALUES (?, ?, ?, ?, 'active')`,
        args: [carePlanId, plantRow.id, diagnosisId, nextVersion],
      })

      const generatedRows: Parameters<typeof mapTask>[0][] = []
      for (const task of taskDrafts) {
        const taskId = randomUUID()
        const insRs = await tx.execute({
          sql: `INSERT INTO care_tasks
             (id, plant_id, care_plan_id, title, details, scheduled_for, status, priority, category)
             VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)
             RETURNING *`,
          args: [
            taskId,
            plantRow.id,
            carePlanId,
            task.title,
            task.details,
            task.scheduledFor,
            task.priority,
            task.category,
          ],
        })
        const ins = rowsFromResultSet<Parameters<typeof mapTask>[0]>(insRs)[0]!
        generatedRows.push(ins)
        await tx.execute({
          sql: 'INSERT INTO task_logs (id, task_id, status, note) VALUES (?, ?, ?, ?)',
          args: [
            randomUUID(),
            taskId,
            'pending',
            'Task creada automáticamente por plan',
          ],
        })
      }

      const diagRs = await tx.execute({
        sql: 'SELECT * FROM diagnoses WHERE id = ?',
        args: [diagnosisId],
      })
      const diagRow = rowsFromResultSet<Parameters<typeof mapDiagnosis>[0]>(diagRs)[0]!

      txResult = { diagnosis: diagRow, generatedTasks: generatedRows }

      await tx.commit()
    } finally {
      tx.close()
    }

    void queueNotificationsForUpcomingTasks().catch((err) =>
      console.error('queueNotificationsForUpcomingTasks:', (err as Error).message),
    )

    return NextResponse.json(
      {
        diagnosis: mapDiagnosis(txResult.diagnosis),
        generatedTasks: txResult.generatedTasks.map(mapTask),
      },
      { status: 201 },
    )
  } catch (error) {
    return NextResponse.json({ message: (error as Error).message }, { status: 400 })
  }
}
