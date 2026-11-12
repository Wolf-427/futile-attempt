import { useEffect } from 'react'
import type { ItemKind, TreeNode } from '@shared/project'
import { DocumentEditor } from './editor/DocumentEditor'
import { Sidebar } from './Sidebar'
import { useApp, type View } from './store'
import { InlineEdit } from './ui'

const VIEWS: { view: View; label: string }[] = [
  { view: 'documents', label: 'Editor' },
  { view: 'boards', label: 'Canvas' },
  { view: 'characters', label: 'Characters' }
]

const COMING: Record<Exclude<ItemKind, 'documents'>, string> = {
  boards: 'The canvas arrives in phase 7.',
  characters: 'Character sheets arrive in phase 8.'
}

function findTitle(tree: TreeNode[], id: string): string | undefined {
  for (const node of tree) {
    if (node.id === id) return node.title
    if (node.type === 'folder') {
      const hit = findTitle(node.children, id)
      if (hit) return hit
    }
  }
  return undefined
}

export function Workspace() {
  const project = useApp((s) => s.project)
  const view = useApp((s) => s.view)
  const selected = useApp((s) => s.selected)
  const renaming = useApp((s) => s.renaming)
  const focus = useApp((s) => s.focus)
  const { closeProject, mutate, setView, startRename } = useApp.getState()

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const state = useApp.getState()
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        state.setFocus(!state.focus)
        return
      }
      if (e.key === 'Escape' && state.focus) state.setFocus(false)
      if (state.renaming || (e.target instanceof HTMLElement && e.target.matches('input, textarea, [contenteditable]'))) return
      const current = state.selected
      if (e.key === 'F2' && current) state.startRename(current.id)
      if (e.key === 'Backspace' && e.metaKey && current) {
        void state.mutate({ op: 'trash', target: current.kind, id: current.id })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (!project) return null
  const { manifest } = project
  const title =
    selected &&
    (selected.kind === 'documents'
      ? findTitle(manifest.tree, selected.id)
      : manifest[selected.kind].find((e) => e.id === selected.id)?.title)
  const state = selected ? project.states[`${selected.kind}/${selected.id}`] : undefined

  return (
    <div className={focus ? 'workspace focus' : 'workspace'} data-testid="workspace">
      <header className="titlebar">
        <div className="titlebar-lights" />
        <button className="titlebar-btn" data-testid="home" title="Close project" onClick={() => void closeProject()}>
          ⌂
        </button>
        {renaming === 'project' ? (
          <InlineEdit
            value={manifest.name}
            onCancel={() => startRename(null)}
            onCommit={(name) => {
              startRename(null)
              void mutate({ op: 'rename', target: 'project', id: manifest.id, title: name })
            }}
          />
        ) : (
          <span className="project-name" data-testid="project-name-label" title="Double-click to rename" onDoubleClick={() => startRename('project')}>
            {manifest.name}
          </span>
        )}
        <div className="titlebar-space" />
        <nav className="nav-group">
          {VIEWS.map((v) => (
            <button key={v.view} className={v.view === view ? 'nav-btn active' : 'nav-btn'} data-testid={`nav-${v.view}`} onClick={() => setView(v.view)}>
              {v.label}
            </button>
          ))}
        </nav>
      </header>
      <div className="body">
        <Sidebar />
        <main className="main">
          {selected?.kind === 'documents' && title !== undefined ? (
            <DocumentEditor key={selected.id} id={selected.id} />
          ) : selected && selected.kind !== 'documents' && title !== undefined ? (
            <div className="placeholder" data-testid="main-pane">
              <h2>{title}</h2>
              {state && state !== 'local' && <p className="placeholder-state">File state: {state}</p>}
              <p>{COMING[selected.kind]}</p>
            </div>
          ) : (
            <div className="placeholder" data-testid="main-empty">
              <p>
                {view === 'documents' ? 'No documents yet.' : view === 'boards' ? 'No boards yet.' : 'No characters yet.'} Add one
                with + in the sidebar.
              </p>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
