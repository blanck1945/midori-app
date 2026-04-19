import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireUser } from '../../../../lib/auth'
import { mapPlant } from '../../../../lib/mappers'
import { queryOne, run } from '../../../../lib/db'

const schema = z.object({ colorRgb: z.string().regex(/^\d{1,3},\d{1,3},\d{1,3}$/) })

type Ctx = { params: Promise<{ plantId: string }> }

export async function PATCH(request: NextRequest, ctx: Ctx) {
  const user = requireUser(request)
  if (!user) return NextResponse.json({ message: 'Token faltante' }, { status: 401 })

  try {
    const { colorRgb } = schema.parse(await request.json())
    const { plantId } = await ctx.params
    await run(
      'UPDATE plants SET color_rgb = ?, updated_at = datetime(\'now\') WHERE id = ? AND user_id = ?',
      [colorRgb, plantId, user.id],
    )
    const row = await queryOne<Parameters<typeof mapPlant>[0]>(
      'SELECT * FROM plants WHERE id = ? AND user_id = ?',
      [plantId, user.id],
    )
    if (!row) return NextResponse.json({ message: 'Planta no encontrada' }, { status: 404 })
    return NextResponse.json(mapPlant(row))
  } catch (error) {
    return NextResponse.json({ message: (error as Error).message }, { status: 400 })
  }
}
