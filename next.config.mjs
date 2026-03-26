/** @type {import('next').NextConfig} */
const nextConfig = {
  /** Vinext fusiona esto con ssr.external (nativos + CJS problemáticos en el runner). */
  serverExternalPackages: ['better-sqlite3', 'jsonwebtoken', 'bcryptjs', 'node-cron'],
}

export default nextConfig
