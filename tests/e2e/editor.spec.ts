import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { createProject, launch, renameTo, row, useTempDirs } from './helpers'

const dirs = useTempDirs()
const paper = (page: Page) => page.getByTestId('paper')

async function documentFile(projectDir: string): Promise<string> {
  const names = await readdir(join(projectDir, 'documents'))
  return join(projectDir, 'documents', names[0] ?? '')
}

test('typing is saved, survives switching documents and an immediate quit', async () => {
  let { app, page } = await launch(dirs.profile(), dirs.workDir())
  await createProject(page, 'Roman')
  const projectDir = join(dirs.workDir(), 'roman')
  const file = await documentFile(projectDir)

  // Opening a document must not write it.
  await expect(paper(page)).toBeVisible()
  const untouched = (await stat(file)).mtimeMs
  await page.waitForTimeout(1500)
  expect((await stat(file)).mtimeMs).toBe(untouched)
  await expect(page.getByTestId('save-state')).toHaveText('Saved')

  await paper(page).click()
  await page.getByTestId('block-style').selectOption('h1')
  await page.keyboard.type('Kapitel Eins')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Die Haustür stand offen. ')
  await page.getByTestId('bold').click()
  await page.keyboard.type('Niemand')
  await page.getByTestId('bold').click()
  await page.keyboard.type(' war zu sehen.')

  await expect(page.getByTestId('save-state')).toHaveText('Saved')
  await expect(page.getByTestId('counts')).toContainText('10 words')
  const saved = JSON.parse(await readFile(file, 'utf8'))
  expect(saved.doc.content[0]).toMatchObject({ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Kapitel Eins' }] })
  expect(saved.doc.content[1].content[1]).toEqual({ type: 'text', text: 'Niemand', marks: [{ type: 'bold' }] })

  // Switch to another document and back.
  await page.getByTestId('add-item').click()
  await renameTo(page, 'Zweites')
  await expect(paper(page)).toHaveText('')
  await row(page, 'Untitled').click()
  await expect(paper(page)).toContainText('Die Haustür stand offen. Niemand war zu sehen.')

  // Type and quit at once, inside the save delay.
  await paper(page).click()
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.type(' Letzter Satz vor dem Beenden.')
  await app.close()
  expect(await readFile(file, 'utf8')).toContain('Letzter Satz vor dem Beenden.')

  // Reopen: identical content.
  ;({ app, page } = await launch(dirs.profile(), dirs.workDir()))
  await page.getByTestId('recent-card').click()
  await expect(paper(page)).toContainText('Niemand war zu sehen.')
  await expect(paper(page)).toContainText('Letzter Satz vor dem Beenden.')
  await expect(paper(page).locator('h1')).toHaveText('Kapitel Eins')
  await expect(paper(page).locator('strong')).toHaveText('Niemand')
  await page.screenshot({ path: 'test-results/editor.png' })
  await app.close()
})

test('find and replace', async () => {
  const { app, page } = await launch(dirs.profile(), dirs.workDir())
  await createProject(page, 'Roman')
  await paper(page).click()
  await page.keyboard.type('Der Hund sah den Hund. Ein ')
  await page.getByTestId('bold').click()
  await page.keyboard.type('Hu')
  await page.getByTestId('bold').click()
  await page.keyboard.type('nd bellte.')

  await page.keyboard.press('ControlOrMeta+f')
  await page.getByTestId('find-input').fill('hund')
  // Found three times, including the one that is half bold.
  await expect(page.getByTestId('find-count')).toHaveText(/of 3/)
  await page.getByTestId('replace-input').fill('Wolf')
  await page.getByTestId('replace-one').click()
  await expect(page.getByTestId('find-count')).toHaveText(/of 2/)
  await page.getByTestId('replace-all').click()
  await expect(page.getByTestId('find-count')).toHaveText('No results')
  await page.keyboard.press('Escape')
  await expect(paper(page)).toHaveText('Der Wolf sah den Wolf. Ein Wolf bellte.')

  // Focus mode hides everything but the page.
  await page.keyboard.press('ControlOrMeta+Shift+f')
  await expect(page.getByTestId('sidebar')).toBeHidden()
  await expect(page.getByTestId('toolbar')).toBeHidden()
  await expect(paper(page)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('sidebar')).toBeVisible()

  // Replace all is one undo step.
  await paper(page).click()
  await page.keyboard.press('ControlOrMeta+z')
  await expect(paper(page)).toContainText('Ein Hund bellte.')
  await app.close()
})

test('pages: text flows onto new pages, never into the gap, and page breaks start a new page', async () => {
  const { app, page } = await launch(dirs.profile(), dirs.workDir())
  await createProject(page, 'Roman')
  await paper(page).click()

  // A list and long paragraphs, enough for several pages.
  const sentence = 'Dies ist ein langer Absatz, der über mehrere Zeilen läuft und irgendwann eine Seitengrenze überquert. '
  await page.evaluate((s) => navigator.clipboard.writeText(s.repeat(9)).catch(() => undefined), sentence)
  for (let i = 0; i < 14; i++) {
    await page.keyboard.insertText(sentence.repeat(9))
    await page.keyboard.press('Enter')
  }
  await expect(page.getByTestId('counts')).toContainText(/[3-9] pages/)

  // No line of text may overlap a page boundary (footer, gap, header of the next page).
  const overlaps = await page.evaluate(() => {
    const root = document.querySelector('[data-testid="paper"]')
    if (!root) return -1
    const gaps = Array.from(root.querySelectorAll('.breaker')).map((b) => b.getBoundingClientRect())
    let count = 0
    for (const block of root.querySelectorAll(':scope > p, :scope > h1, :scope li p')) {
      const range = document.createRange()
      range.selectNodeContents(block)
      for (const line of range.getClientRects()) {
        if (line.height === 0) continue
        if (gaps.some((g) => g.height > 0 && line.bottom > g.top + 1 && line.top < g.bottom - 1)) count++
      }
    }
    return count
  })
  expect(overlaps).toBe(0)

  // At least one paragraph is split: it starts on one page and ends on the next.
  const split = await page.evaluate(() => {
    const root = document.querySelector('[data-testid="paper"]')
    if (!root) return false
    const tops = Array.from(root.querySelectorAll('.breaker')).map((b) => b.getBoundingClientRect().top)
    return Array.from(root.querySelectorAll(':scope > p')).some((p) => {
      const r = p.getBoundingClientRect()
      return tops.some((t) => r.top < t && r.bottom > t)
    })
  })
  expect(split).toBe(true)

  // A manual page break: what follows starts at the top of the next page.
  const before = Number((await page.getByTestId('counts').innerText()).match(/(\d+) pages/)?.[1])
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.type('Vor dem Umbruch.')
  await page.getByTestId('page-break').click()
  await page.keyboard.type('Nach dem Umbruch.')
  await expect(page.getByTestId('counts')).toContainText(`${before + 1} pages`)
  const position = await page.evaluate(() => {
    const root = document.querySelector('[data-testid="paper"]')
    const paragraphs = Array.from(root?.querySelectorAll(':scope > p') ?? [])
    const after = paragraphs.find((p) => p.textContent === 'Nach dem Umbruch.')
    const prior = paragraphs.find((p) => p.textContent === 'Vor dem Umbruch.')
    const gaps = Array.from(root?.querySelectorAll('.breaker') ?? []).map((b) => b.getBoundingClientRect())
    if (!after || !prior) return null
    // A block's box may start above the boundary; its line of text is what counts.
    const lineOf = (el: Element): DOMRect => {
      const range = document.createRange()
      range.selectNodeContents(el)
      return Array.from(range.getClientRects()).find((r) => r.height > 0) ?? el.getBoundingClientRect()
    }
    const a = lineOf(after)
    const gapAbove = gaps.filter((g) => g.height > 0 && g.bottom <= a.top + 1).pop()
    return { gapBetween: !!gapAbove && gapAbove.top >= lineOf(prior).bottom - 1, distance: gapAbove ? a.top - gapAbove.bottom : -1 }
  })
  expect(position?.gapBetween).toBe(true)
  expect(position?.distance).toBeLessThan(4)
  await page.screenshot({ path: 'test-results/pages.png' })
  await app.close()
})
