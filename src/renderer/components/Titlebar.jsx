import React, { useEffect, useCallback, useRef } from 'react'
import { useStore } from '../store'
import styles from './Titlebar.module.css'

export default function Titlebar({ project }) {
  const { view, setView, git, setGit, toggleSidebar } = useStore()
  const timer = useRef(null)

  const refresh = useCallback(async () => {
    if (!project?.dir) return
    // Git status is managed via GitHub Desktop — we just track dirty state locally
  }, [project?.dir])

  useEffect(() => {
    refresh()
    timer.current = setInterval(refresh, 30000)
    return () => clearInterval(timer.current)
  }, [refresh])

  const navBtn = (label, v) => (
    <button
      key={v}
      className={`${styles.navBtn} ${view === v ? styles.active : ''}`}
      onClick={() => setView(v)}
    >
      {label}
    </button>
  )

  return (
    <header className={styles.root}>
      <div className={styles.lights} />

      <button className={styles.iconBtn} onClick={toggleSidebar}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <rect x="1" y="3" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="1.2"/>
          <line x1="5" y1="3" x2="5" y2="13" stroke="currentColor" strokeWidth="1.2"/>
        </svg>
      </button>

      <span className={styles.projectName}>{project.name}</span>

      <div className={styles.nav}>
        {navBtn('Editor', 'editor')}
        {navBtn('Canvas', 'board')}
        {navBtn('Settings', 'settings')}
      </div>

      <div className={styles.spacer} />

      <div className={styles.gitArea}>
        {git.error && <span className={styles.gitErr} title={git.error}>⚠ error</span>}
        <span className={styles.branch}>⎇ {git.branch}</span>
        <span className={`${styles.dot} ${git.dirty ? styles.dirty : styles.clean}`} title={git.dirty ? 'Unsaved changes' : 'All saved'} />
      </div>
    </header>
  )
}
