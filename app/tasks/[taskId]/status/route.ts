import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireUser } from '../../../../lib/auth'
import { mapTask } from '../../../../lib/mappers'
import { queryOne, run } from '../../../../lib/db'

const schema = z.object({ status: z.enum(['pending', 'done', 'skipped']) })

type Ctx = { params: Promise<{ taskId: string }> }

export async function PATCH(request: NextRequest, ctx: Ctx) {
  const user = requireUser(request)
  if (!user) return NextResponse.json({ message: 'Token faltante' }, { status: 401 })

  try {
    const payload = schema.parse(await request.json())
    const { taskId } = await ctx.params
    const upd = run(
      `UPDATE care_tasks
       SET status = ?
       WHERE id = ?
         AND plant_id IN (SELECT id FROM plants WHERE user_id = ?)`,
      [payload.status, taskId, user.id],
    )
    if (upd.changes === 0) {
      return NextResponse.json({ message: 'Tarea no encontrada' }, { status: 404 })
    }

    const row = queryOne<Parameters<typeof mapTask>[0]>(
      `SELECT t.* FROM care_tasks t
       JOIN plants p ON p.id = t.plant_id
       WHERE t.id = ? AND p.user_id = ?`,
      [taskId, user.id],
    )!

    run('INSERT INTO task_logs (id, task_id, status, note) VALUES (?, ?, ?, ?)', [
      randomUUID(),
      taskId,
      payload.status,
      'Actualización manual desde app',
    ])

    return NextResponse.json(mapTask(row))
  } catch (error) {
    return NextResponse.json({ message: (error as Error).message }, { status: 400 })
  }
}
