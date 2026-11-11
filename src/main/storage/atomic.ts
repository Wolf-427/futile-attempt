import { randomBytes } from 'node:crypto'
import { basename, dirname, join } from 'node:path'
import { errorCode, exists, type Fs } from './fs'

const TMP_SUFFIX = '.tmp'

/**
 * Write a file so that a reader sees either the old content or the new
 * content, never a mix: write a temp file next to the target, flush it to
 * disk, then rename it over the target.
 */
export async function atomicWrite(
  fs: Fs,
  path: string,
  data: string,
  options: { exclusive?: boolean } = {}
): Promise<void> {
  const dir = dirname(path)
  await fs.mkdir(dir, { recursive: true })
  if (options.exclusive && (await exists(fs, path))) {
    throw Object.assign(new Error(`File already exists: ${path}`), { code: 'EEXIST' })
  }

  const tmp = join(dir, `.${basename(path)}.${randomBytes(6).toString('hex')}${TMP_SUFFIX}`)
  let handle: Awaited<ReturnType<Fs['open']>> | undefined
  try {
    handle = await fs.open(tmp, 'wx')
    await handle.writeFile(data, 'utf8')
    await handle.sync()
    await handle.close()
    handle = undefined
    await fs.rename(tmp, path)
  } catch (e) {
    try {
      await handle?.close()
    } catch {
      // already failing; the original error is the one that matters
    }
    try {
      await fs.unlink(tmp)
    } catch {
      // a leftover temp file is removed by cleanTempFiles on the next open
    }
    throw e
  }

  // Flush the directory entry too. Not supported everywhere, so best effort.
  try {
    const dirHandle = await fs.open(dir, 'r')
    try {
      await dirHandle.sync()
    } finally {
      await dirHandle.close()
    }
  } catch {
    // ignore
  }
}

/** Remove temp files left behind by a crash between write and rename. */
export async function cleanTempFiles(fs: Fs, dir: string): Promise<number> {
  let names: string[]
  try {
    names = await fs.readdir(dir)
  } catch (e) {
    if (errorCode(e) === 'ENOENT') return 0
    throw e
  }
  let removed = 0
  for (const name of names) {
    if (!name.startsWith('.') || !name.endsWith(TMP_SUFFIX)) continue
    try {
      await fs.unlink(join(dir, name))
      removed++
    } catch {
      // ignore; it will be retried on the next open
    }
  }
  return removed
}
