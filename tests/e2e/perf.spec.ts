import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { createProject, launch, useTempDirs } from './helpers'

const dirs = useTempDirs()

const WORDS = ['Haustür', 'Weltkarte', 'und', 'der', 'Regen', 'fiel', 'über', 'die', 'Küste', 'langsam', 'als', 'niemand', 'mehr', 'damit', 'rechnete', 'während', 'das', 'Schiff', 'im', 'Hafen', 'lag']

/** A novel-sized document: about 100,000 words in paragraphs, headings and a few lists. */
function bigDocument(): { doc: unknown; words: number } {
  let seed = 7
  const next = (): number => (seed = (seed * 1103515245 + 12345) & 0x7fffffff)
  let words = 0
  const sentence = (n: number): string => {
    const out: string[] = []
    for (let i = 0; i < n; i++) out.push(WORDS[next() % WORDS.length] ?? 'und')
    words += n
    return out.join(' ') + '. '
  }
  const paragraph = (): unknown => {
    let text = ''
    for (let s = 0, n = 3 + (next() % 5); s < n; s++) text += sentence(8 + (next() % 14))
    return { type: 'paragraph', content: [{ type: 'text', text }] }
  }
  const content: unknown[] = []
  for (let chapter = 1; words < 100_000; chapter++) {
    content.push({ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: `Kapitel ${chapter}` }] })
    for (let p = 0; p < 40 && words < 100_000; p++) content.push(paragraph())
    content.push({
      type: 'bulletList',
      content: Array.from({ length: 30 }, () => ({ type: 'listItem', content: [paragraph()] }))
    })
    content.push({ type: 'pageBreak' })
  }
  content.push({ type: 'paragraph' })
  return { doc: { type: 'doc', content }, words }
}

test('a 100,000-word document opens, paginates correctly and types without lag', async () => {
  test.setTimeout(180_000)
  let { app, page } = await launch(dirs.profile(), dirs.workDir())
  await createProject(page, 'Roman')
  await app.close()

  const docsDir = join(dirs.workDir(), 'roman', 'documents')
  const file = join(docsDir, (await readdir(docsDir))[0] ?? '')
  const big = bigDocument()
  await writeFile(file, JSON.stringify({ doc: big.doc }))
  const original = await readFile(file, 'utf8')

  ;({ app, page } = await launch(dirs.profile(), dirs.workDir()))
  const opened = Date.now()
  await page.getByTestId('recent-card').click()
  await expect(page.getByTestId('paper')).toBeVisible({ timeout: 60_000 })
  await expect(page.getByTestId('counts')).toContainText(/10\d,\d{3} words/, { timeout: 60_000 })
  const openMs = Date.now() - opened

  // Pages are laid out progressively; wait until the count stops changing.
  const pageCount = async (): Promise<number> =>
    page.evaluate(() => document.querySelectorAll('[data-testid="paper"] .rm-page-break').length)
  let pages = await pageCount()
  for (let stable = 0; stable < 4; ) {
    await page.waitForTimeout(250)
    const now = await pageCount()
    stable = now === pages ? stable + 1 : 0
    pages = now
  }
  const settledMs = Date.now() - opened
  expect(pages).toBeGreaterThan(200)
  await expect(page.getByTestId('counts')).toContainText(`${pages} pages`)

  // Opening it did not rewrite it.
  await page.waitForTimeout(1500)
  expect(await readFile(file, 'utf8')).toBe(original)

  // No line of text, in paragraphs or list items, overlaps a page boundary.
  const layout = await page.evaluate(() => {
    const root = document.querySelector('[data-testid="paper"]')
    if (!root) return { overlaps: -1, splitLists: 0 }
    const gaps = Array.from(root.querySelectorAll('.breaker'))
      .map((b) => b.getBoundingClientRect())
      .filter((g) => g.height > 0)
    let overlaps = 0
    let g = 0
    for (const block of root.querySelectorAll(':scope > p, :scope > h1, :scope li p')) {
      const range = document.createRange()
      range.selectNodeContents(block)
      for (const line of range.getClientRects()) {
        if (line.height === 0) continue
        while (g < gaps.length - 1 && (gaps[g]?.bottom ?? 0) < line.top) g++
        for (const gap of [gaps[g - 1], gaps[g]]) {
          if (gap && line.bottom > gap.top + 1 && line.top < gap.bottom - 1) overlaps++
        }
      }
    }
    const tops = gaps.map((x) => x.top)
    const splitLists = Array.from(root.querySelectorAll(':scope > ul')).filter((ul) => {
      const r = ul.getBoundingClientRect()
      return tops.some((t) => r.top < t && r.bottom > t)
    }).length
    return { overlaps, splitLists }
  })
  expect(layout.overlaps).toBe(0)
  expect(layout.splitLists).toBeGreaterThan(0) // lists continue across pages

  // Typing latency: key press to the frame that shows it.
  await page.evaluate(() => {
    const w = window as unknown as { __lat: number[] }
    w.__lat = []
    document.addEventListener(
      'keydown',
      () => {
        const t = performance.now()
        requestAnimationFrame(() => setTimeout(() => w.__lat.push(performance.now() - t), 0))
      },
      true
    )
  })
  const measure = async (label: string): Promise<{ label: string; median: number; worst: number }> => {
    await page.evaluate(() => ((window as unknown as { __lat: number[] }).__lat = []))
    for (const ch of 'Ein neuer Satz mitten im Text. ') {
      await page.keyboard.type(ch)
      await page.waitForTimeout(40)
    }
    await page.waitForTimeout(300)
    const lat = (await page.evaluate(() => (window as unknown as { __lat: number[] }).__lat)).sort((a, b) => a - b)
    return { label, median: Math.round(lat[Math.floor(lat.length / 2)] ?? -1), worst: Math.round(lat[lat.length - 1] ?? -1) }
  }

  const results = []
  await page.getByTestId('paper').locator('p').first().click()
  results.push(await measure('start'))
  await page.keyboard.press('ControlOrMeta+End')
  results.push(await measure('end'))
  console.log(`PERF words=${big.words} pages=${pages} open=${openMs}ms settled=${settledMs}ms`, JSON.stringify(results))

  for (const r of results) expect(r.median).toBeLessThan(100)

  // The edits were saved into the big file.
  await expect(page.getByTestId('save-state')).toHaveText('Saved', { timeout: 20_000 })
  expect(await readFile(file, 'utf8')).toContain('Ein neuer Satz mitten im Text.')
  await app.close()
})
