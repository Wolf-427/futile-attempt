import React, { useState } from 'react'
import { useStore } from '../store'
import { createProject, openProject } from '../services/project'
import styles from './Welcome.module.css'

export default function Welcome() {
  const { addProject, projects, setActive } = useStore()
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function handleCreate() {
    if (!name.trim()) return
    setBusy(true); setErr('')
    try {
      const folder = await window.api.dialog.folder()
      if (!folder) { setBusy(false); return }
      const p = await createProject(name.trim(), folder)
      addProject({ id: p.id, name: p.name, dir: p.dir })
    } catch (e) { setErr(e.message) }
    setBusy(false)
  }

  async function handleOpen() {
    setBusy(true); setErr('')
    try {
      const folder = await window.api.dialog.folder()
      if (!folder) { setBusy(false); return }
      const p = await openProject(folder)
      const existing = projects.find(x => x.dir === folder)
      if (existing) { setActive(existing.id); return }
      addProject({ id: p.id, name: p.name, dir: folder })
    } catch (e) { setErr(e.message) }
    setBusy(false)
  }

  return (
    <div className={styles.root}>
      <div className={styles.drag} />
      <div className={styles.center}>
        <h1 className={styles.title}>Scriptum</h1>
        <p className={styles.sub}>A place for writing that thinks</p>

        {!creating ? (
          <div className={styles.actions}>
            <button className={`${styles.btn} ${styles.primary}`} onClick={() => setCreating(true)}>New project</button>
            <button className={styles.btn} onClick={handleOpen} disabled={busy}>Open project</button>
          </div>
        ) : (
          <div className={styles.form}>
            <input
              className={styles.input}
              autoFocus
              placeholder="Project name…"
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') { setCreating(false); setName('') } }}
            />
            <div className={styles.formRow}>
              <button className={styles.btn} onClick={() => { setCreating(false); setName(''); setErr('') }} disabled={busy}>Cancel</button>
              <button className={`${styles.btn} ${styles.primary}`} onClick={handleCreate} disabled={busy || !name.trim()}>
                {busy ? 'Creating…' : 'Choose folder →'}
              </button>
            </div>
          </div>
        )}

        {err && <p className={styles.err}>{err}</p>}

        {projects.length > 0 && (
          <div className={styles.recent}>
            <p className={styles.recentLabel}>Recent</p>
            {[...projects].reverse().slice(0, 5).map(p => (
              <button key={p.id} className={styles.recentItem} onClick={() => setActive(p.id)}>
                <span className={styles.recentName}>{p.name}</span>
                <span className={styles.recentPath}>{p.dir}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
