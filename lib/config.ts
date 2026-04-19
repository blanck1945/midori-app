import path from 'node:path'
import dotenv from 'dotenv'

dotenv.config({ path: path.resolve(process.cwd(), '.env') })

export const config = {
  port: Number(process.env.PORT ?? 3333),
  /** URL libSQL (`libsql://`, `https://*.turso.io`, …). Vacío → archivo local vía `databasePath`. */
  tursoDatabaseUrl: process.env.TURSO_DATABASE_URL ?? process.env.DATABASE_URL ?? '',
  /** Token Turso / libSQL Cloud (solo URL remota). */
  tursoAuthToken: process.env.TURSO_AUTH_TOKEN ?? '',
  /** Ruta al archivo SQLite cuando no hay `tursoDatabaseUrl` */
  databasePath: process.env.DATABASE_PATH ?? path.resolve(process.cwd(), 'data', 'midori.sqlite'),
  /** Ejecutar `lib/sql/schema.sql` al iniciar (`executeMultiple`). Desactivar en prod si migrás con CLI. */
  applySchemaOnStartup: process.env.APPLY_SCHEMA_ON_STARTUP !== 'false',
  jwtSecret: process.env.JWT_SECRET ?? 'dev-secret',
  appEnv: process.env.APP_ENV ?? 'development',
  geminiApiKey: process.env.GEMINI_API_KEY ?? '',
  geminiModel: process.env.GEMINI_MODEL ?? 'gemini-2.0-flash',
  r2AccountId: process.env.R2_ACCOUNT_ID ?? '',
  r2AccessKeyId: process.env.R2_ACCESS_KEY_ID ?? '',
  r2SecretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? '',
  r2BucketName: process.env.R2_BUCKET_NAME ?? 'plantcare-photos',
  /** Dominio público de lectura (r2.dev / custom). No usar *.r2.cloudflarestorage.com aquí. */
  r2PublicUrl: process.env.R2_PUBLIC_URL ?? '',
  frontendUrl: process.env.FRONTEND_URL ?? 'http://localhost:3333',
  resendApiKey: process.env.RESEND_API_KEY ?? '',
  /** Remitente verificado en Resend (ej. onboarding@resend.dev o notificaciones@tudominio.com) */
  emailFrom: process.env.EMAIL_FROM ?? '',
}
