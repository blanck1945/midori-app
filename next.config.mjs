/** @type {import('next').NextConfig} */
const nextConfig = {
  /** Vinext fusiona esto con ssr.external (nativos + CJS problemáticos en el runner). */
  serverExternalPackages: [
    '@libsql/client',
    '@libsql/core',
    '@libsql/hrana-client',
    'libsql',
    '@neon-rs/load',
    'detect-libc',
    'jsonwebtoken',
    'bcryptjs',
    'node-cron',
  ],
}

export default nextConfig
