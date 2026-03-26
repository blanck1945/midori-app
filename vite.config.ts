import tailwindcss from '@tailwindcss/vite'
import vinext from 'vinext'
import { defineConfig } from 'vite'

/**
 * Paquetes que no deben evaluarse con el module-runner de Vite (CJS / nativos).
 * - better-sqlite3: binario nativo
 * - jsonwebtoken, bcryptjs: CJS en rutas de auth
 * - node-cron: ESM empaquetado con interop CJS que rompe en el runner (__cjs_module_runner_transform)
 */
const SSR_EXTERNAL = ['better-sqlite3', 'jsonwebtoken', 'bcryptjs', 'node-cron']

export default defineConfig({
  /** Cliente: VITE_PUBLIC_API_URL y NEXT_PUBLIC_API_URL desde `.env` → import.meta.env */
  envPrefix: ['VITE_', 'NEXT_PUBLIC_'],
  plugins: [vinext(), tailwindcss()],
  server: {
    port: 3333,
  },
  ssr: {
    external: SSR_EXTERNAL,
  },
  optimizeDeps: {
    exclude: SSR_EXTERNAL,
  },
})
