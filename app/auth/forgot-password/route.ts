import { NextResponse } from 'next/server'
import { z } from 'zod'
import { queryOne } from '../../../lib/db'
import { config } from '../../../lib/config'
import { sendPasswordResetEmail } from '../../../lib/services/emailService'
import { createPasswordResetToken, generateRawResetToken } from '../../../lib/services/passwordResetService'

const forgotSchema = z.object({
  email: z.string().email(),
})

const GENERIC_OK = {
  message:
    'Si el email está registrado, recibirás instrucciones para restablecer la contraseña.',
}

export async function POST(request: Request) {
  try {
    const body = forgotSchema.parse(await request.json())
    const emailNorm = body.email.trim()
    const user = await queryOne<{ id: string; email: string; password_hash: string | null }>(
      'SELECT id, email, password_hash FROM users WHERE lower(email) = lower(?)',
      [emailNorm],
    )

    if (user?.password_hash) {
      const rawToken = generateRawResetToken()
      await createPasswordResetToken(user.id, rawToken)
      const base = config.frontendUrl.replace(/\/$/, '')
      const resetUrl = `${base}/reset-password?token=${encodeURIComponent(rawToken)}`

      try {
        await sendPasswordResetEmail(user.email, resetUrl)
      } catch (err) {
        console.error('forgot-password email:', (err as Error).message)
      }
    }

    return NextResponse.json(GENERIC_OK)
  } catch (error) {
    return NextResponse.json({ message: (error as Error).message }, { status: 400 })
  }
}
