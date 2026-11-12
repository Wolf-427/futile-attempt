import { getSchema, type Editor, type JSONContent } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { EditorContent, useEditor } from '@tiptap/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ItemLoad } from '@shared/ipc'
import type { ItemStatus } from '@shared/project'
import { registerFlusher } from '../pending'
import { useApp } from '../store'
import { editorExtensions, schemaExtensions } from './extensions'
import { FindBar } from './FindBar'
import { Toolbar } from './Toolbar'
import './editor.css'

const SAVE_DELAY_MS = 400
const COUNT_DELAY_MS = 500

type Failure = Extract<ItemLoad, { ok: false }>

const WAITING: Record<Failure['state'], { title: string; detail: string }> = {
  cloud: { title: 'In the cloud', detail: 'This document is not on this Mac yet. The download has been requested.' },
  downloading: { title: 'Downloading…', detail: 'This document is being downloaded from the cloud.' },
  unavailable: { title: 'Cannot be read right now', detail: 'The file exists but could not be read. Nothing has been changed.' },
  missing: { title: 'File not found', detail: 'The file for this document is missing from the project folder.' }
}

/** Check stored content against the schema before it gets anywhere near an editor. */
function validate(value: unknown): { doc: JSONContent } | { error: string } {
  const doc = (value as { doc?: unknown } | null)?.doc
  if (typeof doc !== 'object' || doc === null) return { error: 'The file does not contain a document.' }
  try {
    getSchema(schemaExtensions()).nodeFromJSON(doc).check()
    return { doc: doc as JSONContent }
  } catch (e) {
    return { error: `The document contains something this version cannot display (${e instanceof Error ? e.message : String(e)}).` }
  }
}

export function DocumentEditor({ id }: { id: string }) {
  const [load, setLoad] = useState<ItemLoad | null>(null)

  const fetchDoc = useCallback(
    async (reload = false): Promise<void> => {
      try {
        setLoad(await (reload ? window.scriptum.items.reload('documents', id) : window.scriptum.items.load('documents', id)))
      } catch (e) {
        setLoad({ ok: false, state: 'unavailable', error: e instanceof Error ? e.message : String(e) })
      }
    },
    [id]
  )

  useEffect(() => {
    setLoad(null)
    void fetchDoc()
  }, [fetchDoc])

  // A document still coming down from the cloud is asked for again until it arrives.
  useEffect(() => {
    if (!load || load.ok || (load.state !== 'cloud' && load.state !== 'downloading')) return
    const timer = setTimeout(() => void fetchDoc(), 2000)
    return () => clearTimeout(timer)
  }, [load, fetchDoc])

  if (!load) return <div className="editor-message" />

  if (!load.ok) {
    const text = WAITING[load.state]
    return (
      <div className="editor-message" data-testid="editor-unavailable">
        <h2>{text.title}</h2>
        <p>{text.detail}</p>
        {load.error && <p className="editor-message-error">{load.error}</p>}
        {(load.state === 'unavailable' || load.state === 'missing') && (
          <button className="btn" onClick={() => void fetchDoc()}>
            Try again
          </button>
        )}
      </div>
    )
  }

  const checked = validate(load.value)
  if ('error' in checked) {
    return (
      <div className="editor-message" data-testid="editor-unavailable">
        <h2>Cannot be displayed</h2>
        <p>{checked.error}</p>
        <p>The file has not been changed.</p>
      </div>
    )
  }
  return <LoadedEditor key={id} id={id} doc={checked.doc} initialStatus={load.status} onReload={() => void fetchDoc(true)} />
}

function LoadedEditor(props: { id: string; doc: JSONContent; initialStatus: ItemStatus; onReload(): void }) {
  const { id } = props
  const [status, setStatus] = useState(props.initialStatus)
  const [counts, setCounts] = useState({ words: 0, characters: 0, pages: 1 })
  const [finding, setFinding] = useState(false)
  const extensions = useMemo(() => editorExtensions(), [])

  // The latest document and whether it still has to be handed to the main process.
  const latest = useRef<PMNode | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const countTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const send = useCallback((): Promise<void> => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = null
    const doc = latest.current
    latest.current = null
    if (!doc) return Promise.resolve()
    return window.scriptum.items
      .update('documents', id, { doc: doc.toJSON() as unknown })
      .catch((e: unknown) => useApp.getState().showError(e instanceof Error ? e.message : String(e)))
  }, [id])

  const recount = useCallback((editor: Editor): void => {
    if (countTimer.current) clearTimeout(countTimer.current)
    countTimer.current = setTimeout(() => {
      if (editor.isDestroyed) return
      const text = editor.state.doc.textBetween(0, editor.state.doc.content.size, ' ', ' ')
      setCounts({
        words: text.match(/\S+/g)?.length ?? 0,
        characters: editor.state.doc.textContent.length,
        pages: Math.max(1, editor.view.dom.querySelectorAll('.rm-page-break').length)
      })
    }, COUNT_DELAY_MS)
  }, [])

  const editor = useEditor({
    extensions,
    content: props.doc,
    // Typing must not re-render React; the toolbar subscribes to what it needs.
    shouldRerenderOnTransaction: false,
    editorProps: { attributes: { class: 'paper', spellcheck: 'true', 'data-testid': 'paper' } },
    onCreate: ({ editor: created }) => recount(created),
    // Fires only for real content changes, so opening a document never saves it.
    onUpdate: ({ editor: updated }) => {
      latest.current = updated.state.doc
      setStatus((s) => (s.saveState === 'conflict' || s.saveState === 'dirty' ? s : { ...s, saveState: 'dirty' }))
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => void send(), SAVE_DELAY_MS)
      recount(updated)
    }
  })

  // Pages are added as the layout settles, without any change to the document,
  // so the page count follows the height of the paper.
  useEffect(() => {
    if (!editor) return
    let timer: ReturnType<typeof setTimeout> | null = null
    const observer = new ResizeObserver(() => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        if (editor.isDestroyed) return
        const pages = Math.max(1, editor.view.dom.querySelectorAll('.rm-page-break').length)
        setCounts((c) => (c.pages === pages ? c : { ...c, pages }))
      }, 150)
    })
    observer.observe(editor.view.dom)
    return () => {
      observer.disconnect()
      if (timer) clearTimeout(timer)
    }
  }, [editor])

  useEffect(() => window.scriptum.items.onStatus((e) => {
    if (e.kind === 'documents' && e.id === id) setStatus(e.status)
  }), [id])

  // Closing the project, window or app asks for pending content first.
  useEffect(() => registerFlusher(send), [send])

  // Switching to another document hands over anything pending and has it written at once.
  useEffect(
    () => () => {
      if (countTimer.current) clearTimeout(countTimer.current)
      if (latest.current) void send().then(() => window.scriptum.items.flush('documents', id).catch(() => undefined))
    },
    [id, send]
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        setFinding(true)
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void send().then(() => window.scriptum.items.flush('documents', id))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [id, send])

  if (!editor) return null

  return (
    <div className="editor" data-testid="editor">
      <Toolbar editor={editor} onFind={() => setFinding(true)} />
      {finding && (
        <FindBar
          editor={editor}
          onClose={() => {
            setFinding(false)
            editor.commands.clearSearch()
            editor.commands.focus()
          }}
        />
      )}
      <div className="desk">
        <EditorContent editor={editor} />
      </div>
      <footer className="editor-status">
        <span data-testid="counts">
          {counts.words.toLocaleString()} words · {counts.characters.toLocaleString()} characters · {counts.pages}{' '}
          {counts.pages === 1 ? 'page' : 'pages'}
        </span>
        <SaveIndicator status={status} onReload={props.onReload} />
      </footer>
    </div>
  )
}

function SaveIndicator({ status, onReload }: { status: ItemStatus; onReload(): void }) {
  if (status.saveState === 'error') {
    return (
      <span className="save save-error" data-testid="save-state" title={status.error ?? ''}>
        Not saved: {status.error ?? 'unknown error'}. Retrying…
      </span>
    )
  }
  if (status.saveState === 'conflict') {
    return (
      <span className="save save-conflict" data-testid="save-state" title={status.conflictPath ?? ''}>
        Changed on another device. Your version is saved as a conflict copy.{' '}
        <button className="link" onClick={onReload}>
          Load the other version
        </button>
      </span>
    )
  }
  const label = status.saveState === 'saved' ? 'Saved' : status.saveState === 'saving' ? 'Saving…' : 'Edited'
  return (
    <span className="save" data-testid="save-state">
      {label}
    </span>
  )
}
