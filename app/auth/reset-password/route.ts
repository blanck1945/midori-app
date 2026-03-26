import bcrypt from 'bcryptjs'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { run } from '../../../lib/db'
import { consumePasswordResetToken, markPasswordResetTokenUsed } from '../../../lib/services/passwordResetService'

const resetSchema = z.object({
  token: z.string().min(10),
  password: z.string().min(6),
})

export async function POST(request: Request) {
  try {
    const body = resetSchema.parse(await request.json())
    const consumed = consumePasswordResetToken(body.token)

    if (!consumed) {
      return NextResponse.json(
        { message: 'El enlace no es válido o expiró. Solicitá uno nuevo.' },
        { status: 400 },
      )
    }

    const passwordHash = await bcrypt.hash(body.password, 10)
    run('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, consumed.userId])
    markPasswordResetTokenUsed(consumed.tokenRowId)

    return NextResponse.json({ ok: true as const })
  } catch (error) {
    return NextResponse.json({ message: (error as Error).message }, { status: 400 })
  }
}
