import * as nodeFs from 'node:fs/promises'

/** The file-system calls the storage layer uses. Tests swap single calls to inject faults. */
export type Fs = Pick<
  typeof nodeFs,
  'readFile' | 'stat' | 'mkdir' | 'readdir' | 'rename' | 'unlink' | 'open'
>

export const realFs: Fs = nodeFs

export function errorCode(e: unknown): string | undefined {
  return typeof e === 'object' && e !== null && 'code' in e
    ? String((e as { code: unknown }).code)
    : undefined
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export async function exists(fs: Fs, path: string): Promise<boolean> {
  try {
    await fs.stat(path)
    return true
  } catch (e) {
    if (errorCode(e) === 'ENOENT') return false
    throw e
  }
}
