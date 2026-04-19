import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireUser } from '../../lib/auth'
import { mapPlant } from '../../lib/mappers'
import { queryAll, queryOne, run } from '../../lib/db'

const plantSchema = z.object({
  name: z.string().min(1),
  speciesGuess: z.string().min(1),
  location: z.string().min(1),
  lightLevel: z.enum(['low', 'medium', 'high']),
})

export async function GET(request: NextRequest) {
  const user = requireUser(request)
  if (!user) return NextResponse.json({ message: 'Token faltante' }, { status: 401 })

  const rows = await queryAll<Parameters<typeof mapPlant>[0]>(
    'SELECT * FROM plants WHERE user_id = ? ORDER BY created_at DESC',
    [user.id],
  )
  return NextResponse.json(rows.map(mapPlant))
}

export async function POST(request: NextRequest) {
  const user = requireUser(request)
  if (!user) return NextResponse.json({ message: 'Token faltante' }, { status: 401 })

  try {
    const payload = plantSchema.parse(await request.json())
    const id = randomUUID()
    await run(
      `INSERT INTO plants (id, user_id, name, species_guess, location, light_level)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, user.id, payload.name, payload.speciesGuess, payload.location, payload.lightLevel],
    )
    const row = (await queryOne<Parameters<typeof mapPlant>[0]>('SELECT * FROM plants WHERE id = ?', [id]))!
    return NextResponse.json(mapPlant(row), { status: 201 })
  } catch (error) {
    return NextResponse.json({ message: (error as Error).message }, { status: 400 })
  }
}
