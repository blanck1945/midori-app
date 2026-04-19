import { randomUUID } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { signToken } from '../../../lib/auth'
import { queryOne, run } from '../../../lib/db'

const registerSchema = z.object({
  email: z.string().email(),
  name: z.string().min(2),
  password: z.string().min(6),
})

export async function POST(request: Request) {
  try {
    const body = registerSchema.parse(await request.json())
    const existing = await queryOne<{ id: string }>('SELECT id FROM users WHERE email = ?', [body.email])
    if (existing) {
      return NextResponse.json({ message: 'El email ya está registrado' }, { status: 409 })
    }
    const passwordHash = await bcrypt.hash(body.password, 10)
    const id = randomUUID()
    await run('INSERT INTO users (id, email, name, password_hash) VALUES (?, ?, ?, ?)', [
      id,
      body.email,
      body.name,
      passwordHash,
    ])
    const user = await queryOne<{ id: string; email: string; name: string }>(
      'SELECT id, email, name FROM users WHERE id = ?',
      [id],
    )!
    const token = signToken(user!)
    return NextResponse.json({ token, user }, { status: 201 })
  } catch (error) {
    return NextResponse.json({ message: (error as Error).message }, { status: 400 })
  }
}
