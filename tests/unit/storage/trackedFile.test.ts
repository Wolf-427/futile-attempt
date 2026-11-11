import { readdir, readFile, stat, utimes, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { cleanTempFiles } from '../../../src/main/storage/atomic'
import { stubPathFor } from '../../../src/main/storage/fileState'
import type { Fs } from '../../../src/main/storage/fs'
import { NotLoadedError, TrackedFile } from '../../../src/main/storage/trackedFile'
import { deferred, fail, FAST, faultyFs, tempDir } from './helpers'

async function seeded(text = 'original'): Promise<{ dir: string; path: string }> {
  const dir = await tempDir()
  const path = join(dir, 'doc.json')
  await writeFile(path, text)
  return { dir, path }
}

describe('rule 1: a file is writable only after a successful read', () => {
  it('a failed read leaves the file untouched and refuses writes', async () => {
    const { path } = await seeded()
    const file = new TrackedFile(path, { ...FAST, fs: faultyFs({ readFile: fail('EIO') as Fs['readFile'] }) })

    const result = await file.load()
    expect(result).toMatchObject({ ok: false, state: 'unavailable' })
    expect(file.text()).toBeNull()
    expect(() => file.update('')).toThrow(NotLoadedError)
    await file.flush()
    expect(await readFile(path, 'utf8')).toBe('original')
  })

  it('a missing file is reported as missing and is not created', async () => {
    const dir = await tempDir()
    const path = join(dir, 'gone.json')
    const file = new TrackedFile(path, FAST)

    expect(await file.load()).toEqual({ ok: false, state: 'missing' })
    expect(() => file.update('x')).toThrow(NotLoadedError)
    await file.flush()
    expect(await readdir(dir)).toEqual([])
  })
})

describe('rule 2: only real changes are written', () => {
  it('opening and flushing never writes', async () => {
    const { path } = await seeded()
    const open = vi.fn(fail('EACCES'))
    const file = new TrackedFile(path, { ...FAST, fs: faultyFs({ open: open as unknown as Fs['open'] }) })
    const before = await stat(path)

    await file.load()
    file.update('original')
    expect((await file.flush()).saveState).toBe('saved')
    expect(open).not.toHaveBeenCalled()
    expect((await stat(path)).mtimeMs).toBe(before.mtimeMs)
  })
})

describe('rule 3: writes are atomic and ordered', () => {
  it('writes the latest content and leaves no temp files', async () => {
    const { dir, path } = await seeded()
    const file = new TrackedFile(path, FAST)
    await file.load()

    for (let i = 0; i < 50; i++) file.update(`version ${i}`)
    expect((await file.flush()).saveState).toBe('saved')
    expect(await readFile(path, 'utf8')).toBe('version 49')
    expect(await readdir(dir)).toEqual(['doc.json'])
  })

  it('a crash between temp write and rename leaves the original intact', async () => {
    const { dir, path } = await seeded('{"valid":true}')
    // The process "dies": the rename never happens and nothing cleans up.
    const crashing = faultyFs({ rename: fail('ECRASH') as Fs['rename'], unlink: fail('ECRASH') as Fs['unlink'] })
    const file = new TrackedFile(path, { ...FAST, retryDelayMs: 60_000, fs: crashing })
    await file.load()
    file.update('{"valid":true,"more":1}')
    await file.flush()
    file.dispose()

    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ valid: true })
    expect((await readdir(dir)).some((n) => n.endsWith('.tmp'))).toBe(true)
    expect(await cleanTempFiles(await import('node:fs/promises'), dir)).toBe(1)
    expect(await readdir(dir)).toEqual(['doc.json'])
  })
})

describe('rule 4: a failed write is reported, kept and retried', () => {
  it('reports the error, keeps the old file, then saves once the disk works again', async () => {
    const { path } = await seeded()
    let broken = true
    const real = await import('node:fs/promises')
    const flaky = faultyFs({
      open: ((...args: Parameters<Fs['open']>) =>
        broken && args[1] === 'wx' ? fail('ENOSPC')() : real.open(...args)) as Fs['open']
    })
    const file = new TrackedFile(path, { ...FAST, fs: flaky })
    await file.load()

    file.update('edited')
    const failed = await file.flush()
    expect(failed.saveState).toBe('error')
    expect(failed.error).toContain('ENOSPC')
    expect(await readFile(path, 'utf8')).toBe('original')
    expect(file.text()).toBe('edited')

    broken = false
    await vi.waitFor(async () => expect(await readFile(path, 'utf8')).toBe('edited'))
    expect((await file.flush()).saveState).toBe('saved')
  })
})

describe('rule 5: flush waits for pending writes', () => {
  it('a change still inside the save delay reaches disk on flush', async () => {
    const { path } = await seeded()
    const file = new TrackedFile(path, { ...FAST, saveDelayMs: 60_000 })
    await file.load()

    file.update('typed just before quitting')
    expect(await readFile(path, 'utf8')).toBe('original')
    expect((await file.flush()).saveState).toBe('saved')
    expect(await readFile(path, 'utf8')).toBe('typed just before quitting')
  })
})

describe('rule 6: external changes are never overwritten', () => {
  it('saves our version to a conflict copy when the file changed on disk', async () => {
    const { dir, path } = await seeded()
    const file = new TrackedFile(path, { ...FAST, now: () => new Date('2026-11-11T21:00:00Z') })
    await file.load()

    await writeFile(path, 'edited on another device')
    await utimes(path, new Date(), new Date(Date.now() + 5000))

    file.update('edited here')
    const status = await file.flush()
    expect(status.saveState).toBe('conflict')
    expect(await readFile(path, 'utf8')).toBe('edited on another device')
    expect(status.conflictPath).toBe(join(dir, 'doc (conflict 2026-11-11T21-00-00).json'))
    expect(await readFile(status.conflictPath ?? '', 'utf8')).toBe('edited here')

    // Later edits keep going to the same conflict copy.
    file.update('edited here again')
    await file.flush()
    expect(await readFile(path, 'utf8')).toBe('edited on another device')
    expect(await readFile(status.conflictPath ?? '', 'utf8')).toBe('edited here again')

    // Reloading picks up the other device's version and clears the conflict.
    expect(await file.reload()).toEqual({ ok: true, text: 'edited on another device' })
    expect(file.status()).toMatchObject({ saveState: 'saved', conflictPath: null })
  })

  it('a changed timestamp with identical content is not a conflict', async () => {
    const { path } = await seeded()
    const file = new TrackedFile(path, FAST)
    await file.load()
    await utimes(path, new Date(), new Date(Date.now() + 5000))

    file.update('edited')
    expect((await file.flush()).saveState).toBe('saved')
    expect(await readFile(path, 'utf8')).toBe('edited')
  })
})

describe('cloud files', () => {
  it('a read that hangs like a download reports downloading, then loads', async () => {
    const { path } = await seeded('from the cloud')
    const gate = deferred<void>()
    const real = await import('node:fs/promises')
    const slow = faultyFs({
      readFile: (async (...args: Parameters<Fs['readFile']>) => {
        await gate.promise
        return real.readFile(...args)
      }) as Fs['readFile']
    })
    const file = new TrackedFile(path, { ...FAST, fs: slow })

    expect(await file.load()).toEqual({ ok: false, state: 'downloading' })
    expect(file.status().fileState).toBe('downloading')
    expect(() => file.update('')).toThrow(NotLoadedError)
    expect(await readFile(path, 'utf8')).toBe('from the cloud')

    gate.resolve()
    await vi.waitFor(() => expect(file.status().fileState).toBe('local'))
    expect(await file.load()).toEqual({ ok: true, text: 'from the cloud' })
  })

  it('an offline download that fails reports unavailable, and a retry can succeed', async () => {
    const { path } = await seeded('from the cloud')
    let offline = true
    const real = await import('node:fs/promises')
    const net = faultyFs({
      readFile: ((...args: Parameters<Fs['readFile']>) =>
        offline ? fail('ETIMEDOUT')() : real.readFile(...args)) as Fs['readFile']
    })
    const file = new TrackedFile(path, { ...FAST, fs: net })

    expect(await file.load()).toMatchObject({ ok: false, state: 'unavailable' })
    offline = false
    expect(await file.load()).toEqual({ ok: true, text: 'from the cloud' })
  })

  it('an iCloud stub is reported as in the cloud and a download is requested', async () => {
    const dir = await tempDir()
    const path = join(dir, 'doc.json')
    await writeFile(stubPathFor(path), 'placeholder')
    const requestDownload = vi.fn()
    const file = new TrackedFile(path, { ...FAST, requestDownload })

    expect(await file.load()).toEqual({ ok: false, state: 'cloud' })
    expect(requestDownload).toHaveBeenCalledWith(path)
    expect(() => file.update('')).toThrow(NotLoadedError)
    expect(await readdir(dir)).toEqual(['.doc.json.icloud'])
  })

  it('a dataless file on macOS triggers a download request and still loads', async () => {
    const { path } = await seeded('dataless content')
    const real = await import('node:fs/promises')
    const dataless = faultyFs({
      stat: (async (...args: Parameters<Fs['stat']>) => {
        const st = await real.stat(...args)
        return Object.assign(Object.create(Object.getPrototypeOf(st) as object), st, { blocks: 0 })
      }) as Fs['stat']
    })
    const requestDownload = vi.fn()
    const file = new TrackedFile(path, { ...FAST, fs: dataless, platform: 'darwin', requestDownload })

    expect(await file.load()).toEqual({ ok: true, text: 'dataless content' })
    expect(requestDownload).toHaveBeenCalledWith(path)
  })
})

describe('creating files', () => {
  it('never overwrites an existing file', async () => {
    const { path } = await seeded()
    await expect(TrackedFile.createNew(path, 'new', FAST)).rejects.toMatchObject({ code: 'EEXIST' })
    expect(await readFile(path, 'utf8')).toBe('original')
  })
})
