import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '../../../../../../lib/auth'
import { config } from '../../../../../../lib/config'
import { queryOne } from '../../../../../../lib/db'
import { getObjectBuffer, r2ObjectKeyFromStoredUrl } from '../../../../../../lib/services/storageService'

type Ctx = { params: Promise<{ plantId: string; photoId: string }> }

export async function GET(request: NextRequest, ctx: Ctx) {
  const user = requireUser(request)
  if (!user) return NextResponse.json({ message: 'Token faltante' }, { status: 401 })

  const { plantId, photoId } = await ctx.params

  const plantRow = queryOne<{ id: string }>('SELECT id FROM plants WHERE id = ? AND user_id = ?', [
    plantId,
    user.id,
  ])
  if (!plantRow) {
    return NextResponse.json({ message: 'Planta no encontrada' }, { status: 404 })
  }

  const photoRow = queryOne<{ image_url: string }>(
    'SELECT image_url FROM plant_photos WHERE id = ? AND plant_id = ?',
    [photoId, plantId],
  )
  if (!photoRow) {
    return NextResponse.json({ message: 'Foto no encontrada' }, { status: 404 })
  }

  const raw = photoRow.image_url

  if (raw.startsWith('data:')) {
    const match = raw.match(/^data:([^;]+);base64,([\s\S]+)$/)
    if (!match) {
      return NextResponse.json({ message: 'Formato de imagen inválido' }, { status: 400 })
    }
    const contentType = match[1]
    const buffer = Buffer.from(match[2], 'base64')
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'private, max-age=3600',
      },
    })
  }

  const key = r2ObjectKeyFromStoredUrl(raw)
  if (!key) {
    return NextResponse.json({ message: 'URL de imagen no reconocida' }, { status: 400 })
  }

  if (!config.r2AccountId || !config.r2AccessKeyId || !config.r2SecretAccessKey) {
    return NextResponse.json({ message: 'Almacenamiento R2 no configurado' }, { status: 503 })
  }

  try {
    const { buffer, contentType } = await getObjectBuffer(key)
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'private, max-age=3600',
      },
    })
  } catch (err) {
    console.error('R2 GetObject:', (err as Error).message)
    return NextResponse.json({ message: 'No se pudo leer la imagen' }, { status: 502 })
  }
}
