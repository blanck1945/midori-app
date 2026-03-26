import bcrypt from 'bcryptjs'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireUser, signToken } from '../../../lib/auth'
import { queryOne, run } from '../../../lib/db'

const patchSchema = z.object({
  name: z.string().min(2).optional(),
  email: z.string().email().optional(),
  currentPassword: z.string().min(1).optional(),
  newPassword: z.string().min(6).optional(),
})

export async function PATCH(request: NextRequest) {
  try {
    const user = requireUser(request)
    if (!user) return NextResponse.json({ message: 'Token faltante' }, { status: 401 })

    const body = patchSchema.parse(await request.json())

    const hasName = body.name !== undefined
    const hasEmail = body.email !== undefined
    const hasNewPassword = body.newPassword !== undefined

    if (!hasName && !hasEmail && !hasNewPassword) {
      return NextResponse.json({ message: 'Nada que actualizar' }, { status: 400 })
    }

    const row = queryOne<{
      id: string
      email: string
      name: string
      password_hash: string | null
    }>('SELECT id, email, name, password_hash FROM users WHERE id = ?', [user.id])

    if (!row) {
      return NextResponse.json({ message: 'Usuario no encontrado' }, { status: 404 })
    }

    const nameVal = hasName ? body.name!.trim() : row.name
    const emailVal = hasEmail ? body.email!.trim() : row.email

    const nameChanged = hasName && nameVal !== row.name
    const emailChanged = hasEmail && emailVal.toLowerCase() !== row.email.toLowerCase()
    const passwordChange = hasNewPassword

    if (!nameChanged && !emailChanged && !passwordChange) {
      return NextResponse.json({ message: 'Nada que actualizar' }, { status: 400 })
    }

    if (emailChanged || passwordChange) {
      if (!body.currentPassword) {
        return NextResponse.json({ message: 'Contraseña actual requerida' }, { status: 400 })
      }
      if (!row.password_hash) {
        return NextResponse.json({ message: 'Contraseña actual incorrecta' }, { status: 401 })
      }
      const valid = await bcrypt.compare(body.currentPassword, row.password_hash)
      if (!valid) {
        return NextResponse.json({ message: 'Contraseña actual incorrecta' }, { status: 401 })
      }
    }

    if (emailChanged) {
      const taken = queryOne<{ id: string }>(
        'SELECT id FROM users WHERE lower(email) = lower(?) AND id != ?',
        [emailVal, row.id],
      )
      if (taken) {
        return NextResponse.json({ message: 'El email ya está registrado' }, { status: 409 })
      }
    }

    const updates: string[] = []
    const params: unknown[] = []

    if (nameChanged) {
      updates.push('name = ?')
      params.push(nameVal)
    }
    if (emailChanged) {
      updates.push('email = ?')
      params.push(emailVal)
    }
    if (passwordChange) {
      updates.push('password_hash = ?')
      params.push(await bcrypt.hash(body.newPassword!, 10))
    }

    params.push(row.id)
    run(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, params)

    const updated = queryOne<{ id: string; email: string; name: string }>(
      'SELECT id, email, name FROM users WHERE id = ?',
      [row.id],
    )!

    const token = signToken(updated)
    return NextResponse.json({ token, user: updated })
  } catch (error) {
    return NextResponse.json({ message: (error as Error).message }, { status: 400 })
  }
}
