import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { queryOne, run } from '../db'

export function hashResetToken(rawToken: string): string {
  return createHash('sha256').update(rawToken, 'utf8').digest('hex')
}

/** Token largo apto para URL (base64url). */
export function generateRawResetToken(): string {
  return randomBytes(32).toString('base64url')
}

export function createPasswordResetToken(userId: string, rawToken: string): void {
  const tokenHash = hashResetToken(rawToken)
  run('DELETE FROM password_reset_tokens WHERE user_id = ? AND used_at IS NULL', [userId])
  const id = randomUUID()
  run(
    `INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at)
     VALUES (?, ?, ?, datetime('now', '+1 hour'))`,
    [id, userId, tokenHash],
  )
}

export function consumePasswordResetToken(
  rawToken: string,
): { userId: string; tokenRowId: string } | null {
  const tokenHash = hashResetToken(rawToken)
  const row = queryOne<{
    id: string
    user_id: string
    expires_at: string
    used_at: string | null
  }>('SELECT id, user_id, expires_at, used_at FROM password_reset_tokens WHERE token_hash = ?', [tokenHash])

  if (!row || row.used_at) return null

  const expires = new Date(row.expires_at).getTime()
  if (Number.isNaN(expires) || Date.now() > expires) return null

  return { userId: row.user_id, tokenRowId: row.id }
}

export function markPasswordResetTokenUsed(tokenRowId: string): void {
  run(`UPDATE password_reset_tokens SET used_at = datetime('now') WHERE id = ?`, [tokenRowId])
}
