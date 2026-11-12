import { mkdtemp, readFile, rename, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'

// Chromium's OS-level sandbox cannot start as root on Linux CI machines.
const args = ['.', ...(process.platform === 'linux' ? ['--no-sandbox'] : [])]

let profile: string
let workDir: string

test.beforeEach(async () => {
  profile = await mkdtemp(join(tmpdir(), 'scriptum-e2e-profile-'))
  workDir = await mkdtemp(join(tmpdir(), 'scriptum-e2e-work-'))
})

test.afterEach(async () => {
  await rm(profile, { recursive: true, force: true })
  await rm(workDir, { recursive: true, force: true })
})

/** Launch with a throwaway profile. `pick` is what every folder dialog answers. */
async function launch(pick: string): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args,
    env: { ...process.env, SCRIPTUM_USER_DATA: profile, SCRIPTUM_E2E_PICK_DIR: pick }
  })
  return { app, page: await app.firstWindow() }
}

const row = (page: Page, title: string) =>
  page.locator('[data-testid="item-row"], [data-testid="folder-row"]').filter({ hasText: title })

async function renameTo(page: Page, title: string): Promise<void> {
  const input = page.getByTestId('rename-input')
  await input.fill(title)
  await input.press('Enter')
  await expect(input).toHaveCount(0)
}

test('the renderer is isolated and only sees the declared API', async () => {
  const { app, page } = await launch(workDir)
  try {
    await expect(page.getByTestId('app-title')).toHaveText('Scriptum')
    const surface = await page.evaluate(() => ({
      hasRequire: typeof (globalThis as Record<string, unknown>)['require'] !== 'undefined',
      hasProcess: typeof (globalThis as Record<string, unknown>)['process'] !== 'undefined',
      api: Object.keys(window.scriptum).sort()
    }))
    expect(surface).toEqual({ hasRequire: false, hasProcess: false, api: ['app', 'project', 'projects'] })
  } finally {
    await app.close()
  }
})

test('create, organise, close, move the folder in Finder, reopen: nothing is lost', async () => {
  // ── first session ────────────────────────────────────────────────────────
  let { app, page } = await launch(workDir)
  await page.getByTestId('new-project').click()
  await page.getByTestId('project-name').fill('Mein Roman')
  await page.getByTestId('create-project').click()
  await expect(page.getByTestId('workspace')).toBeVisible()
  await expect(row(page, 'Untitled')).toBeVisible()

  // New document, named inline.
  await page.getByTestId('add-item').click()
  await renameTo(page, 'Kapitel 1')
  await expect(page.getByTestId('main-pane')).toContainText('Kapitel 1')

  // New folder, and a document created inside it from the context menu.
  await page.getByTestId('add-folder').click()
  await renameTo(page, 'Teil Eins')
  await row(page, 'Teil Eins').click({ button: 'right' })
  await page.getByText('New document here').click()
  await renameTo(page, 'Szene A')

  // Drag "Kapitel 1" into the folder.
  await row(page, 'Kapitel 1').dragTo(row(page, 'Teil Eins'))
  await expect.poll(async () => page.locator('[data-testid="item-row"]').allInnerTexts()).toEqual(
    expect.arrayContaining([expect.stringContaining('Kapitel 1')])
  )

  // Rename by double-click.
  await row(page, 'Untitled').dblclick()
  await renameTo(page, 'Prolog')

  // Trash and restore.
  await row(page, 'Szene A').click({ button: 'right' })
  await page.getByText('Move to Trash').click()
  await expect(row(page, 'Szene A')).toHaveCount(0)
  await page.getByTestId('trash-toggle').click()
  await expect(page.getByTestId('trash-row')).toContainText('Szene A')
  await page.getByTestId('restore').click()
  await expect(row(page, 'Szene A')).toBeVisible()

  // Boards and characters.
  // Switching views switches the main pane too: to the item last open there, else the first.
  await row(page, 'Prolog').click()
  await page.getByTestId('nav-boards').click()
  await expect(row(page, 'Master board')).toBeVisible()
  await expect(page.getByTestId('main-pane')).toContainText('Master board')
  await page.getByTestId('nav-characters').click()
  await expect(page.getByTestId('main-empty')).toContainText('No characters yet')
  await page.getByTestId('add-item').click()
  await renameTo(page, 'Kath')
  await expect(page.getByTestId('main-pane')).toContainText('Kath')
  await page.getByTestId('nav-documents').click()
  await expect(page.getByTestId('main-pane')).toContainText('Prolog')
  await page.getByTestId('nav-characters').click()
  await expect(page.getByTestId('main-pane')).toContainText('Kath')
  await page.screenshot({ path: 'test-results/workspace.png' })

  // Back to the start screen: the project is in the recent list.
  await page.getByTestId('home').click()
  await expect(page.getByTestId('recent-card')).toHaveCount(1)
  await expect(page.getByTestId('recent-card')).toContainText('Mein Roman')
  await page.screenshot({ path: 'test-results/start.png' })
  await app.close()

  // ── the folder is moved while the app is closed ──────────────────────────
  const original = join(workDir, 'mein-roman')
  const moved = join(workDir, 'Verschoben')
  const manifest = JSON.parse(await readFile(join(original, 'scriptum.json'), 'utf8'))
  expect(JSON.stringify(manifest)).not.toContain(workDir) // no absolute paths inside the project
  await rename(original, moved)

  // ── second session ───────────────────────────────────────────────────────
  ;({ app, page } = await launch(moved))
  const card = page.getByTestId('recent-card')
  await expect(card).toContainText('Folder not found')
  await card.click() // "locate": the folder dialog answers with the new location
  await expect(page.getByTestId('workspace')).toBeVisible()

  await expect(row(page, 'Prolog')).toBeVisible()
  await expect(row(page, 'Teil Eins')).toBeVisible()
  await expect(row(page, 'Kapitel 1')).toBeVisible()
  await expect(row(page, 'Szene A')).toBeVisible()
  await expect(row(page, 'Untitled')).toHaveCount(0)
  await page.getByTestId('nav-characters').click()
  await expect(row(page, 'Kath')).toBeVisible()

  // The moved project replaced its old entry instead of adding a second one.
  await page.getByTestId('home').click()
  await expect(page.getByTestId('recent-card')).toHaveCount(1)
  await expect(page.getByTestId('recent-card')).not.toContainText('Folder not found')
  await app.close()

  const after = JSON.parse(await readFile(join(moved, 'scriptum.json'), 'utf8'))
  const folder = after.tree.find((n: { title: string }) => n.title === 'Teil Eins')
  expect(after.tree.map((n: { title: string }) => n.title)).toContain('Prolog')
  expect(folder.children.map((n: { title: string }) => n.title).sort()).toEqual(['Kapitel 1'])
})
