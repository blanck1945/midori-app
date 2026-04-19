import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireUser } from '../../../../lib/auth'
import { MAX_PLANT_PHOTOS } from '../../../../lib/constants'
import { queryAll, queryOne, run } from '../../../../lib/db'
import { mapPlantPhoto } from '../../../../lib/mappers'
import { getPlantPhotoCount } from '../../../../lib/plantPhoto'
import { uploadImageFromDataUrl } from '../../../../lib/services/storageService'

type Ctx = { params: Promise<{ plantId: string }> }

export async function GET(request: NextRequest, ctx: Ctx) {
  const user = requireUser(request)
  if (!user) return NextResponse.json({ message: 'Token faltante' }, { status: 401 })

  const { plantId } = await ctx.params
  const ownership = await queryOne<{ id: string }>('SELECT id FROM plants WHERE id = ? AND user_id = ?', [
    plantId,
    user.id,
  ])
  if (!ownership) {
    return NextResponse.json({ message: 'Planta no encontrada' }, { status: 404 })
  }

  const result = await queryAll<{
    id: string
    plant_id: string
    image_url: string
    note: string | null
    context: string | null
    captured_at: string
  }>(
    `SELECT id, plant_id, image_url, note, context, captured_at
     FROM plant_photos
     WHERE plant_id = ?
     ORDER BY captured_at DESC`,
    [plantId],
  )

  return NextResponse.json(result.map(mapPlantPhoto))
}

const postSchema = z.object({
  imageUrl: z
    .string()
    .min(10)
    .refine(
      (s) =>
        /^data:image\/[^;]+;base64,/.test(s) ||
        /^https?:\/\//.test(s) ||
        s.startsWith('file://') ||
        s.startsWith('content://'),
      { message: 'imageUrl debe ser data URL, http(s), file:// o content://' },
    ),
  note: z.string().optional(),
  context: z.string().optional(),
})

export async function POST(request: NextRequest, ctx: Ctx) {
  const user = requireUser(request)
  if (!user) return NextResponse.json({ message: 'Token faltante' }, { status: 401 })

  try {
    const payload = postSchema.parse(await request.json())
    const { plantId } = await ctx.params
    const ownership = await queryOne<{ id: string }>('SELECT id FROM plants WHERE id = ? AND user_id = ?', [
      plantId,
      user.id,
    ])
    if (!ownership) {
      return NextResponse.json({ message: 'Planta no encontrada' }, { status: 404 })
    }

    if ((await getPlantPhotoCount(plantId)) >= MAX_PLANT_PHOTOS) {
      return NextResponse.json(
        { message: `Máximo ${MAX_PLANT_PHOTOS} fotos por planta` },
        { status: 409 },
      )
    }

    let storedUrl = payload.imageUrl
    if (payload.imageUrl.startsWith('data:')) {
      const key = `plants/${plantId}/${Date.now()}-${randomUUID().slice(0, 8)}.jpg`
      try {
        storedUrl = await uploadImageFromDataUrl(payload.imageUrl, key)
      } catch (err) {
        console.warn('R2 upload failed (photos), storing data URL as fallback:', (err as Error).message)
      }
    }

    const id = randomUUID()
    await run(
      `INSERT INTO plant_photos (id, plant_id, image_url, note, context)
       VALUES (?, ?, ?, ?, ?)`,
      [id, plantId, storedUrl, payload.note ?? null, payload.context ?? null],
    )
    const row = await queryOne<{
      id: string
      plant_id: string
      image_url: string
      note: string | null
      context: string | null
      captured_at: string
    }>('SELECT id, plant_id, image_url, note, context, captured_at FROM plant_photos WHERE id = ?', [id])!

    return NextResponse.json(mapPlantPhoto(row!), { status: 201 })
  } catch (error) {
    return NextResponse.json({ message: (error as Error).message }, { status: 400 })
  }
}
