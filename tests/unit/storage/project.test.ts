import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Fs } from '../../../src/main/storage/fs'
import { ProjectStore } from '../../../src/main/storage/project'
import { StorageService } from '../../../src/main/storage/service'
import { SnapshotStore } from '../../../src/main/storage/snapshots'
import { FAST, faultyFs, tempDir } from './helpers'

const options = { file: FAST }
const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', text }] })

async function opened(dir: string, extra = {}): Promise<ProjectStore> {
  const result = await ProjectStore.open(dir, { ...options, ...extra })
  if (!result.ok) throw new Error(`open failed: ${result.reason}`)
  return result.project
}

describe('creating projects', () => {
  it('writes a format 2 manifest and the project folders', async () => {
    const parent = await tempDir()
    const project = await ProjectStore.create(parent, 'Mein Roman', options)

    expect(project.dir).toBe(join(parent, 'mein-roman'))
    const manifest = JSON.parse(await readFile(join(project.dir, 'scriptum.json'), 'utf8'))
    expect(manifest).toMatchObject({ formatVersion: 2, name: 'Mein Roman', tree: [], boards: [], characters: [] })
    expect((await readdir(project.dir)).sort()).toEqual(['assets', 'boards', 'characters', 'documents', 'scriptum.json', 'trash'])
  })

  it('never writes into an existing folder', async () => {
    const parent = await tempDir()
    const first = await ProjectStore.create(parent, 'Novel', options)
    const id = await first.createItem('documents', 'Chapter 1', doc('keep me'))
    await first.close()

    const second = await ProjectStore.create(parent, 'Novel', options)
    expect(second.dir).toBe(join(parent, 'novel-2'))
    expect((await opened(first.dir)).manifest.tree).toEqual([{ type: 'document', id, title: 'Chapter 1' }])
  })
})

describe('opening projects', () => {
  it('a v1 project is reported as needing import and is not modified', async () => {
    const dir = await tempDir()
    const v1 = JSON.stringify({ id: 'abc', name: 'Old', created: 1 }, null, 2)
    await writeFile(join(dir, 'scriptum.json'), v1)
    await mkdir(join(dir, 'documents'))
    await writeFile(join(dir, 'documents', 'Untitled.md'), '# Old\n\n')

    expect(await ProjectStore.open(dir, options)).toEqual({ ok: false, reason: 'needs-import' })
    expect(await readFile(join(dir, 'scriptum.json'), 'utf8')).toBe(v1)
    expect(await readdir(join(dir, 'documents'))).toEqual(['Untitled.md'])
  })

  it('a manifest still downloading is not mistaken for an invalid or empty project', async () => {
    const parent = await tempDir()
    const project = await ProjectStore.create(parent, 'Cloud', options)
    await project.close()
    const hanging = faultyFs({ readFile: (() => new Promise(() => {})) as Fs['readFile'] })

    expect(await ProjectStore.open(project.dir, { ...options, fs: hanging })).toEqual({ ok: false, reason: 'downloading' })
    expect(await ProjectStore.open(join(parent, 'nowhere'), options)).toEqual({ ok: false, reason: 'missing' })
    expect(await readdir(parent)).toEqual(['cloud'])
  })

  it('a project from a newer app version is refused, not rewritten', async () => {
    const dir = await tempDir()
    const text = JSON.stringify({ formatVersion: 3, id: 'x', name: 'Future' })
    await writeFile(join(dir, 'scriptum.json'), text)
    expect(await ProjectStore.open(dir, options)).toEqual({ ok: false, reason: 'newer-format' })
    expect(await readFile(join(dir, 'scriptum.json'), 'utf8')).toBe(text)
  })
})

describe('items', () => {
  it('content survives save, close, moving the folder and reopening', async () => {
    const parent = await tempDir()
    const project = await ProjectStore.create(parent, 'Novel', options)
    const id = await project.createItem('documents', 'Chapter 1', doc(''))
    const board = await project.createItem('boards', 'Master board', { nodes: [], edges: [] })

    const text = 'Haustür, Weltkarte — “quotes”, <tags> & *stars*\n\n\n'
    project.updateItem('documents', id, doc(text))
    await project.renameItem('documents', id, 'Kapitel 1')
    expect(await project.close()).toEqual([])

    const moved = join(parent, 'moved-elsewhere')
    await rename(project.dir, moved)

    const again = await opened(moved)
    expect(again.manifest.tree).toEqual([{ type: 'document', id, title: 'Kapitel 1' }])
    expect(again.manifest.boards).toEqual([{ id: board, title: 'Master board' }])
    expect(await again.loadItem('documents', id)).toEqual({ ok: true, value: doc(text) })
    expect(await again.itemStates()).toEqual({ [`documents/${id}`]: 'local', [`boards/${board}`]: 'local' })
  })

  it('an item that cannot be read is never replaced by an empty one', async () => {
    const parent = await tempDir()
    const project = await ProjectStore.create(parent, 'Novel', options)
    const id = await project.createItem('documents', 'Chapter 1', doc('precious'))
    await project.close()
    const path = join(project.dir, 'documents', `${id}.json`)
    const before = await readFile(path, 'utf8')

    const real = await import('node:fs/promises')
    const offline = faultyFs({
      readFile: ((...args: Parameters<Fs['readFile']>) =>
        String(args[0]).includes('documents') ? Promise.reject(new Error('offline')) : real.readFile(...args)) as Fs['readFile']
    })
    const again = await opened(project.dir, { fs: offline })

    expect(await again.loadItem('documents', id)).toMatchObject({ ok: false, state: 'unavailable' })
    expect(() => again.updateItem('documents', id, doc(''))).toThrow(/not loaded/)
    expect(await again.close()).toEqual([])
    expect(await readFile(path, 'utf8')).toBe(before)
  })

  it('a corrupt item is reported and cannot be written over', async () => {
    const parent = await tempDir()
    const project = await ProjectStore.create(parent, 'Novel', options)
    const id = await project.createItem('documents', 'Chapter 1', doc('x'))
    await project.close()
    const path = join(project.dir, 'documents', `${id}.json`)
    await writeFile(path, '{"type":"doc","content":[{"ty')

    const again = await opened(project.dir)
    expect(await again.loadItem('documents', id)).toMatchObject({ ok: false, state: 'unavailable' })
    expect(() => again.updateItem('documents', id, doc(''))).toThrow(/not loaded/)
    await again.close()
    expect(await readFile(path, 'utf8')).toBe('{"type":"doc","content":[{"ty')
  })

  it('rejects ids that would escape the project folder', async () => {
    const project = await ProjectStore.create(await tempDir(), 'Novel', options)
    await expect(project.loadItem('documents', '../../etc/passwd')).rejects.toThrow(/Invalid item id/)
    await expect(project.createItem('documents', 'x', doc(''), 'no-such-folder')).rejects.toThrow(/No such folder/)
    expect(await readdir(join(project.dir, 'documents'))).toEqual([])
  })
})

describe('snapshots', () => {
  it('keeps the content from before the first edit of a session, outside the project', async () => {
    const parent = await tempDir()
    const snapshotRoot = await tempDir()
    const snapshots = new SnapshotStore(snapshotRoot, { keep: 2 })
    const project = await ProjectStore.create(parent, 'Novel', { ...options, snapshots })
    const id = await project.createItem('documents', 'Chapter 1', doc('first draft'))
    await project.close()

    const projectId = project.manifest.id
    for (const text of ['second draft', 'third draft', 'fourth draft']) {
      const session = await opened(project.dir, { snapshots })
      await session.loadItem('documents', id)
      session.updateItem('documents', id, doc(text))
      session.updateItem('documents', id, doc(text + '!'))
      await session.close()
    }

    const list = await snapshots.list(projectId, 'documents', id)
    expect(list).toHaveLength(2)
    const newest = list[0]
    expect(newest).toBeDefined()
    expect(JSON.parse(await snapshots.read(projectId, 'documents', id, newest?.name ?? ''))).toEqual(doc('third draft!'))
    expect(JSON.stringify(await readdir(project.dir, { recursive: true }))).not.toContain('session-start')
  })
})

describe('StorageService', () => {
  it('flushes every open project on quit', async () => {
    const parent = await tempDir()
    const service = new StorageService(await tempDir(), { file: { ...FAST, saveDelayMs: 60_000 } })
    const project = await service.createProject(parent, 'Novel')
    const id = await project.createItem('documents', 'Chapter 1', doc(''))

    project.updateItem('documents', id, doc('last words before quitting'))
    expect(await service.flushAll()).toEqual([])
    const onDisk = JSON.parse(await readFile(join(project.dir, 'documents', `${id}.json`), 'utf8'))
    expect(onDisk).toEqual(doc('last words before quitting'))
    expect(await service.closeProject(project.dir)).toEqual([])
  })
})
