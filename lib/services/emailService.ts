import { config } from '../config'

/**
 * Envía el correo de recuperación vía Resend.
 * Sin RESEND_API_KEY: en desarrollo solo loguea la URL en consola (sin exponer en JSON al cliente).
 */
export async function sendPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
  const isDev = config.appEnv === 'development' || process.env.NODE_ENV === 'development'

  if (!config.resendApiKey || !config.emailFrom) {
    if (isDev) {
      console.warn('[Midori] Password reset (sin RESEND_API_KEY / EMAIL_FROM). Enlace:')
      console.warn(resetUrl)
      return
    }
    console.error('[Midori] RESEND_API_KEY o EMAIL_FROM no configurados; no se envió email de recuperación')
    return
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: config.emailFrom,
      to: [to],
      subject: 'Restablecer contraseña — Midori',
      html: `<p>Hacé clic para restablecer tu contraseña:</p><p><a href="${resetUrl}">${resetUrl}</a></p><p>Si no solicitaste esto, ignorá el mensaje.</p>`,
    }),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(text || `Resend HTTP ${res.status}`)
  }
}
