import * as nodeFs from 'node:fs/promises'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach } from 'vitest'
import type { Fs } from '../../../src/main/storage/fs'

const dirs: string[] = []

afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

export async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'scriptum-test-'))
  dirs.push(dir)
  return dir
}

/** The real file system with selected calls replaced. */
export function faultyFs(overrides: Partial<Fs>): Fs {
  return { ...nodeFs, ...overrides }
}

export function fail(code: string): () => Promise<never> {
  return () => Promise.reject(Object.assign(new Error(`${code}: injected failure`), { code }))
}

/** A promise that can be resolved from the outside, for reads that hang like a cloud download. */
export function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

export const FAST = { saveDelayMs: 5, retryDelayMs: 20, readTimeoutMs: 50 } as const
