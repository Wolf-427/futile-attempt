import { execFile } from 'node:child_process'
import { basename, dirname, join } from 'node:path'
import { errorCode, exists, type Fs } from './fs'

/**
 * - local:    a normal file
 * - dataless: listed with its real name and size, but its bytes are in the
 *             cloud (iCloud Drive since macOS 14, and File Provider services).
 *             Reading it triggers the download and blocks until it finishes.
 * - stub:     only a hidden `.name.icloud` placeholder exists (older macOS)
 * - missing:  neither exists
 */
export type Presence = 'local' | 'dataless' | 'stub' | 'missing'

export function stubPathFor(path: string): string {
  return join(dirname(path), `.${basename(path)}.icloud`)
}

export async function probe(
  fs: Fs,
  path: string,
  platform: NodeJS.Platform = process.platform
): Promise<Presence> {
  try {
    const st = await fs.stat(path)
    // A dataless file reports its full size but occupies no blocks. Only
    // trusted on macOS: other file systems store small files inline and
    // report zero blocks for ordinary local files.
    if (platform === 'darwin' && st.size > 0 && st.blocks === 0) return 'dataless'
    return 'local'
  } catch (e) {
    if (errorCode(e) !== 'ENOENT') throw e
    return (await exists(fs, stubPathFor(path))) ? 'stub' : 'missing'
  }
}

/** Ask iCloud Drive to download a file. Best effort; other services download on read. */
export function requestICloudDownload(path: string): void {
  if (process.platform !== 'darwin') return
  execFile('/usr/bin/brctl', ['download', path], () => {
    // Failure is fine: the file stays in the "cloud" state and the user can retry.
  })
}
