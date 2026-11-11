// Prints how a file looks to the storage layer. Used to confirm cloud-file
// detection on a real Mac:  npm run probe -- "/path/to/file"
import { stat, readdir } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

const path = process.argv[2]
if (!path) {
  console.error('usage: npm run probe -- "/path/to/file"')
  process.exit(1)
}

try {
  const st = await stat(path)
  const dataless = process.platform === 'darwin' && st.size > 0 && st.blocks === 0
  console.log(JSON.stringify({ path, size: st.size, blocks: st.blocks, flags: st.flags ?? null, verdict: dataless ? 'dataless (in cloud)' : 'local' }, null, 2))
} catch (e) {
  if (e.code !== 'ENOENT') throw e
  const stub = `.${basename(path)}.icloud`
  const names = await readdir(dirname(path)).catch(() => [])
  console.log(JSON.stringify({ path, verdict: names.includes(stub) ? `stub (${join(dirname(path), stub)})` : 'missing' }, null, 2))
}
