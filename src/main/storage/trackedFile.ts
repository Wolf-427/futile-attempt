import { basename, dirname, extname, join } from 'node:path'
import type { FileState, ItemStatus, SaveState } from '@shared/project'
import { atomicWrite } from './atomic'
import { probe, requestICloudDownload } from './fileState'
import { errorCode, errorMessage, realFs, type Fs } from './fs'

export class NotLoadedError extends Error {
  constructor(path: string) {
    super(`Refusing to write a file that was not loaded successfully: ${path}`)
    this.name = 'NotLoadedError'
  }
}

export type LoadResult =
  | { ok: true; text: string }
  | { ok: false; state: Exclude<FileState, 'local'>; error?: string }

export interface TrackedFileOptions {
  fs?: Fs
  platform?: NodeJS.Platform
  /** How long a read may take before the file is reported as downloading. */
  readTimeoutMs?: number
  /** Delay between the last change and the write. */
  saveDelayMs?: number
  /** Delay before a failed write is retried. */
  retryDelayMs?: number
  requestDownload?: (path: string) => void
  /** Called once per session with the loaded content, before the first write replaces it. */
  beforeFirstWrite?: (loadedText: string) => Promise<void>
  onChange?: (file: TrackedFile) => void
  now?: () => Date
}

interface Loaded {
  text: string
  mtimeMs: number
  size: number
}

/**
 * One file on disk, with the storage rules enforced in one place:
 *
 * 1. It can only be written after it was read successfully.
 * 2. It is only written when its content actually changed.
 * 3. Writes are atomic and strictly ordered, one at a time.
 * 4. A failed write is reported, kept as unsaved, and retried.
 * 5. flush() waits until everything pending is on disk.
 * 6. If the file changed on disk since it was loaded, it is not overwritten;
 *    our version goes to a conflict copy next to it.
 */
export class TrackedFile {
  readonly path: string
  private readonly fs: Fs
  private readonly options: TrackedFileOptions

  private fileState: FileState = 'missing'
  private saveState: SaveState = 'saved'
  private lastError: string | null = null

  private loaded: Loaded | null = null
  private reading: Promise<LoadResult> | null = null
  private pending: string | null = null
  private chain: Promise<void> = Promise.resolve()
  private saveTimer: ReturnType<typeof setTimeout> | null = null
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private snapshotTaken = false
  private conflictPath: string | null = null
  private conflictText: string | null = null
  private generation = 0

  constructor(path: string, options: TrackedFileOptions = {}) {
    this.path = path
    this.options = options
    this.fs = options.fs ?? realFs
  }

  /** Create a new file. Fails if one already exists; never overwrites. */
  static async createNew(
    path: string,
    text: string,
    options: TrackedFileOptions = {}
  ): Promise<TrackedFile> {
    const file = new TrackedFile(path, options)
    await atomicWrite(file.fs, path, text, { exclusive: true })
    const st = await file.fs.stat(path)
    file.loaded = { text, mtimeMs: st.mtimeMs, size: st.size }
    file.fileState = 'local'
    // Nothing existed before this session, so there is nothing to snapshot.
    file.snapshotTaken = true
    return file
  }

  get isLoaded(): boolean {
    return this.loaded !== null
  }

  status(): ItemStatus {
    return {
      fileState: this.fileState,
      saveState: this.saveState,
      error: this.lastError,
      conflictPath: this.conflictPath
    }
  }

  /** The content as the app currently holds it, or null if the file is not loaded. */
  text(): string | null {
    if (!this.loaded) return null
    return this.pending ?? this.conflictText ?? this.loaded.text
  }

  /**
   * Read the file. A slow read (a cloud download) returns `downloading` after
   * the timeout and keeps going in the background; call load() again later.
   */
  async load(): Promise<LoadResult> {
    if (this.loaded) return { ok: true, text: this.text() ?? this.loaded.text }

    if (!this.reading) {
      const generation = this.generation
      this.reading = this.read(generation).finally(() => {
        if (this.generation === generation) this.reading = null
      })
    }

    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), this.options.readTimeoutMs ?? 4000)
    })
    const result = await Promise.race([this.reading, timeout])
    clearTimeout(timer)

    if (result === 'timeout') {
      this.setState({ fileState: 'downloading' })
      return { ok: false, state: 'downloading' }
    }
    return result
  }

  /** Forget the loaded content and any conflict, then read the file again. */
  async reload(): Promise<LoadResult> {
    this.clearTimers()
    await this.chain
    this.generation++
    this.reading = null
    this.loaded = null
    this.pending = null
    this.conflictPath = null
    this.conflictText = null
    this.lastError = null
    this.saveState = 'saved'
    return this.load()
  }

  /** Replace the content. The write happens after a short delay; flush() forces it. */
  update(text: string): void {
    if (!this.loaded) throw new NotLoadedError(this.path)
    const onDisk = this.conflictPath ? this.conflictText : this.loaded.text
    if (text === onDisk && this.saveState !== 'saving') {
      this.pending = null
      this.clearTimers()
      this.setState({ saveState: this.conflictPath ? 'conflict' : 'saved' })
      return
    }
    this.pending = text
    if (this.saveState !== 'saving') this.setState({ saveState: 'dirty' })
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      this.enqueueWrite()
    }, this.options.saveDelayMs ?? 800)
  }

  /** Write anything pending now and wait for it. Resolves with the resulting status. */
  async flush(): Promise<ItemStatus> {
    this.clearTimers()
    if (this.pending !== null) this.enqueueWrite()
    await this.chain
    return this.status()
  }

  /** Stop timers. Pending content is not written; call flush() first. */
  dispose(): void {
    this.clearTimers()
  }

  // ── internals ────────────────────────────────────────────────────────────

  private async read(generation: number): Promise<LoadResult> {
    const current = (): boolean => this.generation === generation
    try {
      const presence = await probe(this.fs, this.path, this.options.platform)
      if (!current()) return { ok: false, state: 'unavailable', error: 'superseded' }

      if (presence === 'missing') {
        this.setState({ fileState: 'missing' })
        return { ok: false, state: 'missing' }
      }
      if (presence === 'stub' || presence === 'dataless') {
        ;(this.options.requestDownload ?? requestICloudDownload)(this.path)
      }
      if (presence === 'stub') {
        this.setState({ fileState: 'cloud' })
        return { ok: false, state: 'cloud' }
      }

      // Read between two stats. If the file changed while we read it, read
      // again, so the remembered timestamp always belongs to the remembered text.
      for (let attempt = 0; ; attempt++) {
        const before = await this.fs.stat(this.path)
        const text = await this.fs.readFile(this.path, 'utf8')
        const after = await this.fs.stat(this.path)
        if (!current()) return { ok: false, state: 'unavailable', error: 'superseded' }
        if (before.mtimeMs === after.mtimeMs && before.size === after.size) {
          this.loaded = { text, mtimeMs: after.mtimeMs, size: after.size }
          this.lastError = null
          this.setState({ fileState: 'local', saveState: 'saved' })
          return { ok: true, text }
        }
        if (attempt >= 3) throw new Error('File kept changing while it was being read')
      }
    } catch (e) {
      if (!current()) return { ok: false, state: 'unavailable', error: 'superseded' }
      if (errorCode(e) === 'ENOENT') {
        this.setState({ fileState: 'missing' })
        return { ok: false, state: 'missing' }
      }
      const error = errorMessage(e)
      this.lastError = error
      this.setState({ fileState: 'unavailable' })
      return { ok: false, state: 'unavailable', error }
    }
  }

  private enqueueWrite(): void {
    this.chain = this.chain.then(() => this.writeLatest())
  }

  private async writeLatest(): Promise<void> {
    const text = this.pending
    const loaded = this.loaded
    if (text === null || !loaded) return

    const onDisk = this.conflictPath ? this.conflictText : loaded.text
    if (text === onDisk) {
      this.pending = null
      this.setState({ saveState: this.conflictPath ? 'conflict' : 'saved' })
      return
    }

    this.setState({ saveState: 'saving' })
    try {
      if (!this.snapshotTaken) {
        this.snapshotTaken = true
        try {
          await this.options.beforeFirstWrite?.(loaded.text)
        } catch {
          // A failed snapshot must never block saving the user's work.
        }
      }

      if (!this.conflictPath && (await this.changedOnDisk(loaded))) {
        this.conflictPath = this.newConflictPath()
      }

      if (this.conflictPath) {
        await atomicWrite(this.fs, this.conflictPath, text)
        this.conflictText = text
      } else {
        await atomicWrite(this.fs, this.path, text)
        const st = await this.fs.stat(this.path)
        this.loaded = { text, mtimeMs: st.mtimeMs, size: st.size }
      }

      // Content may have changed again while we were writing.
      if (this.pending === text) this.pending = null
      this.lastError = null
      this.setState({
        saveState: this.conflictPath ? 'conflict' : this.pending === null ? 'saved' : 'dirty'
      })
    } catch (e) {
      this.lastError = errorMessage(e)
      this.setState({ saveState: 'error' })
      this.scheduleRetry()
    }
  }

  /** True if someone else changed the file since we loaded or last wrote it. */
  private async changedOnDisk(loaded: Loaded): Promise<boolean> {
    let st: Awaited<ReturnType<Fs['stat']>>
    try {
      st = await this.fs.stat(this.path)
    } catch (e) {
      // Deleted elsewhere: recreating it keeps the user's text, so not a conflict.
      if (errorCode(e) === 'ENOENT') return false
      throw e
    }
    if (st.mtimeMs === loaded.mtimeMs && st.size === loaded.size) return false

    let diskText: string
    try {
      diskText = await this.fs.readFile(this.path, 'utf8')
    } catch {
      // Cannot verify what is there now, so do not overwrite it.
      return true
    }
    if (diskText === loaded.text) {
      // Only the timestamp moved (a sync client touched it). Same content.
      loaded.mtimeMs = st.mtimeMs
      loaded.size = st.size
      return false
    }
    return true
  }

  private newConflictPath(): string {
    const ext = extname(this.path)
    const stem = basename(this.path, ext)
    const stamp = (this.options.now?.() ?? new Date())
      .toISOString()
      .replace(/[:.]/g, '-')
      .slice(0, 19)
    return join(dirname(this.path), `${stem} (conflict ${stamp})${ext}`)
  }

  private scheduleRetry(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      if (this.pending !== null) this.enqueueWrite()
    }, this.options.retryDelayMs ?? 5000)
  }

  private clearTimers(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.saveTimer = null
    this.retryTimer = null
  }

  private setState(next: { fileState?: FileState; saveState?: SaveState }): void {
    const fileState = next.fileState ?? this.fileState
    const saveState = next.saveState ?? this.saveState
    if (fileState === this.fileState && saveState === this.saveState) return
    this.fileState = fileState
    this.saveState = saveState
    this.options.onChange?.(this)
  }
}
