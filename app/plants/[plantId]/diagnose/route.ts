import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireUser } from '../../../../lib/auth'
import { getDb } from '../../../../lib/db'
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

    const plantRow = getDb()
      .prepare('SELECT * FROM plants WHERE id = ? AND user_id = ?')
      .get(plantId, user.id) as
      | {
          id: string
          name: string
          species_guess: string
          location: string
          light_level: string
        }
      | undefined

    if (!plantRow) {
      return NextResponse.json({ message: 'Planta no encontrada' }, { status: 404 })
    }

    if (getPlantPhotoCount(plantId) >= MAX_PLANT_PHOTOS) {
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

    const db = getDb()
    const txResult = db.transaction(() => {
      const photoId = randomUUID()
      db.prepare(
        `INSERT INTO plant_photos (id, plant_id, image_url, note, context)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(photoId, plantRow.id, storedImageUrl, payload.note ?? null, payload.context)

      const diagnosisId = randomUUID()
      db.prepare(
        `INSERT INTO diagnoses
         (id, plant_id, photo_id, severity, confidence, summary, detected_issues, recommendations, raw_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        diagnosisId,
        plantRow.id,
        photoId,
        diagnosisData.severity,
        diagnosisData.confidence,
        diagnosisData.summary,
        JSON.stringify(diagnosisData.detectedIssues),
        JSON.stringify(diagnosisData.recommendations),
        JSON.stringify(diagnosisData),
      )

      db.prepare(
        `UPDATE care_plans
         SET status = 'archived', ended_at = datetime('now')
         WHERE plant_id = ? AND status = 'active'`,
      ).run(plantRow.id)

      const versionRow = db
        .prepare('SELECT COALESCE(MAX(version), 0) + 1 AS next_version FROM care_plans WHERE plant_id = ?')
        .get(plantRow.id) as { next_version: number }
      const nextVersion = Number(versionRow.next_version)

      const carePlanId = randomUUID()
      db.prepare(
        `INSERT INTO care_plans (id, plant_id, diagnosis_id, version, status)
         VALUES (?, ?, ?, ?, 'active')`,
      ).run(carePlanId, plantRow.id, diagnosisId, nextVersion)

      const generatedRows: Parameters<typeof mapTask>[0][] = []
      for (const task of taskDrafts) {
        const taskId = randomUUID()
        const ins = db
          .prepare(
            `INSERT INTO care_tasks
             (id, plant_id, care_plan_id, title, details, scheduled_for, status, priority, category)
             VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)
             RETURNING *`,
          )
          .get(
            taskId,
            plantRow.id,
            carePlanId,
            task.title,
            task.details,
            task.scheduledFor,
            task.priority,
            task.category,
          ) as Parameters<typeof mapTask>[0]
        generatedRows.push(ins)
        db.prepare('INSERT INTO task_logs (id, task_id, status, note) VALUES (?, ?, ?, ?)').run(
          randomUUID(),
          taskId,
          'pending',
          'Task creada automáticamente por plan',
        )
      }

      const diagRow = db.prepare('SELECT * FROM diagnoses WHERE id = ?').get(diagnosisId) as Parameters<
        typeof mapDiagnosis
      >[0]

      return { diagnosis: diagRow, generatedTasks: generatedRows }
    })()

    queueNotificationsForUpcomingTasks()

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
