import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'

// Chromium's OS-level sandbox cannot start as root on Linux CI machines.
const args = ['.', ...(process.platform === 'linux' ? ['--no-sandbox'] : [])]

export interface Session {
  app: ElectronApplication
  page: Page
}

/** Per-test throwaway profile and working folder. */
export function useTempDirs(): { profile(): string; workDir(): string } {
  let profile = ''
  let workDir = ''
  test.beforeEach(async () => {
    profile = await mkdtemp(join(tmpdir(), 'scriptum-e2e-profile-'))
    workDir = await mkdtemp(join(tmpdir(), 'scriptum-e2e-work-'))
  })
  test.afterEach(async () => {
    await rm(profile, { recursive: true, force: true })
    await rm(workDir, { recursive: true, force: true })
  })
  return { profile: () => profile, workDir: () => workDir }
}

/** Launch with a throwaway profile. `pick` is what every folder dialog answers. */
export async function launch(profile: string, pick: string): Promise<Session> {
  const app = await electron.launch({
    args,
    env: { ...process.env, SCRIPTUM_USER_DATA: profile, SCRIPTUM_E2E_PICK_DIR: pick }
  })
  const page = await app.firstWindow()
  await page.setViewportSize({ width: 1280, height: 900 }).catch(() => undefined)
  return { app, page }
}

export async function createProject(page: Page, name: string): Promise<void> {
  await page.getByTestId('new-project').click()
  await page.getByTestId('project-name').fill(name)
  await page.getByTestId('create-project').click()
  await expect(page.getByTestId('workspace')).toBeVisible()
}

export const row = (page: Page, title: string) =>
  page.locator('[data-testid="item-row"], [data-testid="folder-row"]').filter({ hasText: title })

export async function renameTo(page: Page, title: string): Promise<void> {
  const input = page.getByTestId('rename-input')
  await input.fill(title)
  await input.press('Enter')
  await expect(input).toHaveCount(0)
}
