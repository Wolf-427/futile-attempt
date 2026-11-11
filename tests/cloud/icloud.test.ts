/**
 * Runs the storage layer against real iCloud Drive on this Mac:
 * create a project, wait for upload, evict it, then open it again.
 * Everything it creates lives in one folder that is removed at the end.
 */
import { execFile } from 'node:child_process'
import { rm, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { expect, test } from 'vitest'
import { probe } from '../../src/main/storage/fileState'
import { realFs } from '../../src/main/storage/fs'
import { ProjectStore } from '../../src/main/storage/project'

const run = promisify(execFile)
const ICLOUD = join(homedir(), 'Library/Mobile Documents/com~apple~CloudDocs')
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const log = (...args: unknown[]) => console.log('[cloud-check]', ...args)

async function describeFile(path: string): Promise<string> {
  const st = await stat(path)
  return `size=${st.size} blocks=${st.blocks} presence=${await probe(realFs, path)}`
}

async function evict(path: string): Promise<void> {
  // A file can only be evicted once it has finished uploading, so retry.
  let last = ''
  for (let i = 0; i < 60; i++) {
    try {
      await run('/usr/bin/brctl', ['evict', path])
      if ((await probe(realFs, path)) !== 'local') return
      last = 'evict returned but the file is still local'
    } catch (e) {
      last = e instanceof Error ? e.message : String(e)
    }
    await sleep(2000)
  }
  throw new Error(`Could not evict ${path} within 2 minutes: ${last}`)
}

const available =
  process.platform === 'darwin' &&
  (await stat(ICLOUD).then(
    () => true,
    () => false
  ))

test.skipIf(!available)('an evicted iCloud project opens with its content intact', async () => {
  const parent = join(ICLOUD, `scriptum-cloud-check-${Date.now()}`)
  const content = { type: 'doc', content: [{ type: 'paragraph', text: 'Haustür, Weltkarte, cloud check' }] }
  try {
    const project = await ProjectStore.create(parent, 'Cloud Check')
    const id = await project.createItem('documents', 'Chapter 1', content)
    expect(await project.close()).toEqual([])
    const manifestPath = join(project.dir, 'scriptum.json')
    const docPath = join(project.dir, 'documents', `${id}.json`)
    log('created', project.dir)
    log('before evict  manifest:', await describeFile(manifestPath))
    log('before evict  document:', await describeFile(docPath))

    log('waiting for upload, then evicting (up to 2 minutes per file)…')
    await evict(manifestPath)
    await evict(docPath)
    log('after evict   manifest:', await describeFile(manifestPath))
    log('after evict   document:', await describeFile(docPath))
    expect(await probe(realFs, docPath)).not.toBe('local')

    const started = Date.now()
    let opened = await ProjectStore.open(project.dir, { file: { readTimeoutMs: 1500 } })
    log('first open:', opened.ok ? 'ok' : opened.reason, `after ${Date.now() - started} ms`)
    for (let i = 0; !opened.ok && i < 60; i++) {
      expect(['downloading', 'cloud', 'unavailable']).toContain(opened.reason)
      await sleep(1000)
      opened = await ProjectStore.open(project.dir, { file: { readTimeoutMs: 1500 } })
    }
    if (!opened.ok) throw new Error(`project never became available: ${opened.reason}`)

    log('states before reading the document:', JSON.stringify(await opened.project.itemStates()))
    let item = await opened.project.loadItem('documents', id)
    for (let i = 0; !item.ok && i < 60; i++) {
      log('document state:', item.state)
      await sleep(1000)
      item = await opened.project.loadItem('documents', id)
    }
    expect(item).toEqual({ ok: true, value: content })
    log(`document loaded intact ${Date.now() - started} ms after opening`)
    expect(await opened.project.close()).toEqual([])
    log('RESULT: PASS')
  } finally {
    await rm(parent, { recursive: true, force: true })
  }
})
