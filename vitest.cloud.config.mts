import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

// Real-machine check against iCloud Drive. Run with: npm run cloud-check
export default defineConfig({
  resolve: { alias: { '@shared': resolve(import.meta.dirname, 'src/shared') } },
  test: { include: ['tests/cloud/**/*.test.ts'], environment: 'node', testTimeout: 300_000 }
})
