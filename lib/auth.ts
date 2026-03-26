import jwt from 'jsonwebtoken'
import { NextRequest } from 'next/server'
import { config } from './config'

export type AuthUser = { id: string; email: string; name: string }

export function signToken(user: { id: string; email: string; name: string }) {
  return jwt.sign({ sub: user.id, email: user.email, name: user.name }, config.jwtSecret, {
    expiresIn: '30d',
  })
}

export function getBearerToken(request: NextRequest): string | null {
  const authHeader = request.headers.get('authorization') ?? ''
  return authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : null
}

export function getUserFromRequest(request: NextRequest): AuthUser | null {
  const token = getBearerToken(request)
  if (!token) return null
  try {
    const payload = jwt.verify(token, config.jwtSecret) as jwt.JwtPayload & {
      sub?: string
      email?: string
      name?: string
    }
    if (!payload.sub || !payload.email) return null
    return { id: payload.sub, email: payload.email, name: payload.name ?? '' }
  } catch {
    return null
  }
}

export function requireUser(request: NextRequest): AuthUser | null {
  return getUserFromRequest(request)
}
