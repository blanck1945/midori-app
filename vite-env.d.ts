/// <reference types="vinext" />

/** Variables expuestas al cliente (ver vite.config.ts `envPrefix`). */
interface ImportMetaEnv {
  readonly VITE_PUBLIC_API_URL?: string
  readonly NEXT_PUBLIC_API_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
