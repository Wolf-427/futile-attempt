import { useState } from 'react'
import type { RecentProject } from '@shared/ipc'
import { useApp } from './store'
import { Modal } from './ui'

function when(ms: number): string {
  const days = Math.floor((Date.now() - ms) / 86_400_000)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 30) return `${days} days ago`
  return new Date(ms).toLocaleDateString()
}

function Card({ project }: { project: RecentProject }) {
  const openProject = useApp((s) => s.openProject)
  const forgetProject = useApp((s) => s.forgetProject)
  const missing = project.state === 'missing'

  return (
    <div
      className={missing ? 'card card-missing' : 'card'}
      data-testid="recent-card"
      title={project.dir}
      onClick={() => void openProject(missing ? undefined : project.dir)}
    >
      <div className="card-thumb">
        <span>{project.name.slice(0, 1).toUpperCase()}</span>
        <button
          className="card-remove"
          title="Remove from this list (the project folder is not touched)"
          onClick={(e) => {
            e.stopPropagation()
            void forgetProject(project.dir)
          }}
        >
          ×
        </button>
      </div>
      <div className="card-name">{project.name}</div>
      <div className="card-meta">
        {missing ? 'Folder not found. Click to locate it.' : project.state === 'cloud' ? `In the cloud · ${when(project.openedAt)}` : when(project.openedAt)}
      </div>
    </div>
  )
}

export function StartScreen() {
  const recent = useApp((s) => s.recent)
  const createProject = useApp((s) => s.createProject)
  const openProject = useApp((s) => s.openProject)
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')

  const submit = async (): Promise<void> => {
    if (!name.trim()) return
    if (await createProject(name)) {
      setNaming(false)
      setName('')
    }
  }

  return (
    <main className="start" data-testid="start-screen">
      <div className="start-drag" />
      <header className="start-header">
        <h1 data-testid="app-title">Scriptum</h1>
        <div className="start-actions">
          <button className="btn btn-primary" data-testid="new-project" onClick={() => setNaming(true)}>
            New project
          </button>
          <button className="btn" data-testid="open-project" onClick={() => void openProject()}>
            Open folder…
          </button>
        </div>
      </header>

      {recent.length === 0 ? (
        <p className="start-empty">No projects yet. Create one, or open an existing project folder.</p>
      ) : (
        <section className="cards">
          {recent.map((p) => (
            <Card key={p.dir} project={p} />
          ))}
        </section>
      )}

      {naming && (
        <Modal title="New project" onClose={() => setNaming(false)}>
          <input
            autoFocus
            className="field"
            data-testid="project-name"
            placeholder="Project name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submit()
            }}
          />
          <p className="modal-detail">Next you choose the folder it is saved in.</p>
          <div className="modal-actions">
            <button className="btn" onClick={() => setNaming(false)}>
              Cancel
            </button>
            <button className="btn btn-primary" data-testid="create-project" disabled={!name.trim()} onClick={() => void submit()}>
              Choose folder…
            </button>
          </div>
        </Modal>
      )}
    </main>
  )
}
