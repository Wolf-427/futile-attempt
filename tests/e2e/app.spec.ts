import { _electron as electron, expect, test } from '@playwright/test'

// Chromium's OS-level sandbox cannot start as root on Linux CI machines.
const args = ['.', ...(process.platform === 'linux' ? ['--no-sandbox'] : [])]

test('opens a window and reaches the main process through the typed API', async () => {
  const app = await electron.launch({ args })
  try {
    const page = await app.firstWindow()
    await expect(page.getByTestId('app-title')).toHaveText('Scriptum')
    await expect(page.getByTestId('app-version')).toContainText('v2.0.0-dev.1')

    // The renderer is isolated: no Node, and only the declared API is exposed.
    const surface = await page.evaluate(() => ({
      hasRequire: typeof (globalThis as Record<string, unknown>)['require'] !== 'undefined',
      hasProcess: typeof (globalThis as Record<string, unknown>)['process'] !== 'undefined',
      api: Object.keys(window.scriptum)
    }))
    expect(surface).toEqual({ hasRequire: false, hasProcess: false, api: ['app'] })
  } finally {
    await app.close()
  }
})
