import path from 'node:path'
import dotenv from 'dotenv'

dotenv.config({ path: path.resolve(process.cwd(), '.env') })

export const config = {
  port: Number(process.env.PORT ?? 3333),
  /** Ruta al archivo SQLite (prod: volumen persistente o D1 export) */
  databasePath: process.env.DATABASE_PATH ?? path.resolve(process.cwd(), 'data', 'midori.sqlite'),
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
}
