// Import a v1 Scriptum project:  npm run import -- "/path/to/v1-project"
// Writes a new folder next to it, named "<folder>-v2". The v1 folder is only read.
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { formatReport, importV1Project } from '../src/main/import/v1project'
import { SnapshotStore } from '../src/main/storage/snapshots'

const arg = process.argv[2]
if (!arg) {
  console.error('usage: npm run import -- "/path/to/v1-project"')
  process.exit(2)
}

const source = resolve(arg.replace(/\/+$/, ''))
const destination = `${source}-v2`
// The same folder the app uses for snapshots (Electron's userData on macOS).
const snapshots =
  process.platform === 'darwin'
    ? new SnapshotStore(join(homedir(), 'Library/Application Support/Scriptum/snapshots'))
    : undefined

try {
  const report = await importV1Project(source, destination, snapshots ? { snapshots } : {})
  console.log(formatReport(report))
  process.exit(report.errors.length ? 1 : 0)
} catch (e) {
  console.error(`Import failed: ${e instanceof Error ? e.message : String(e)}`)
  process.exit(2)
}
