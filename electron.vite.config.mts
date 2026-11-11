import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

const shared = { '@shared': resolve(import.meta.dirname, 'src/shared') }

export default defineConfig({
  main: { resolve: { alias: shared } },
  // The preload runs in a sandboxed renderer, so everything except `electron`
  // must be bundled into it.
  preload: { resolve: { alias: shared }, build: { externalizeDeps: false } },
  renderer: {
    resolve: { alias: { ...shared, '@renderer': resolve(import.meta.dirname, 'src/renderer/src') } },
    plugins: [react()]
  }
})
