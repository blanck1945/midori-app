import bcrypt from 'bcryptjs'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { signToken } from '../../../lib/auth'
import { queryOne } from '../../../lib/db'

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

export async function POST(request: Request) {
  try {
    const body = loginSchema.parse(await request.json())
    const row = await queryOne<{
      id: string
      email: string
      name: string
      password_hash: string | null
    }>('SELECT * FROM users WHERE email = ?', [body.email])
    if (!row || !row.password_hash) {
      return NextResponse.json({ message: 'Credenciales inválidas' }, { status: 401 })
    }
    const valid = await bcrypt.compare(body.password, row.password_hash)
    if (!valid) {
      return NextResponse.json({ message: 'Credenciales inválidas' }, { status: 401 })
    }
    const token = signToken({ id: row.id, email: row.email, name: row.name })
    return NextResponse.json({ token, user: { id: row.id, email: row.email, name: row.name } })
  } catch (error) {
    return NextResponse.json({ message: (error as Error).message }, { status: 400 })
  }
}
