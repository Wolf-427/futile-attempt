import React, { useEffect, useState, useCallback } from 'react'
import { useStore } from '../../store'
import { readDocs, readBoards, newBoard } from '../../services/project'
import styles from './Sidebar.module.css'

export default function Sidebar({ project }) {
  const { docPath, setDoc, view, boardFile, openBoard } = useStore()
  const [docs, setDocs] = useState([])
  const [boards, setBoards] = useState([])
  const [adding, setAdding] = useState(false)
  const [dname, setDname] = useState('')

  const load = useCallback(async () => {
    if (!project?.dir) return
    setDocs(await readDocs(project.dir))
    setBoards(await readBoards(project.dir))
  }, [project?.dir])

  useEffect(() => { load() }, [load])

  async function addDoc() {
    if (!dname.trim()) return
    const p = `${project.dir}/documents/${dname.trim()}.md`
    await window.api.fs.write(p, `# ${dname.trim()}\n\n`)
    setAdding(false); setDname('')
    await load(); setDoc(p)
  }

  async function addBoard() {
    const b = await newBoard(project.dir, `Board ${boards.filter(x => !x.isMaster).length + 1}`)
    await load(); openBoard(b.file)
  }

  return (
    <aside className={styles.root}>
      <div className={styles.section}>
        <div className={styles.header}>
          <span className={styles.label}>Documents</span>
          <button className={styles.addBtn} onClick={() => setAdding(true)}>+</button>
        </div>
        {adding && (
          <input
            autoFocus
            className={styles.newInput}
            placeholder="Name…"
            value={dname}
            onChange={e => setDname(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') addDoc(); if (e.key === 'Escape') { setAdding(false); setDname('') } }}
            onBlur={() => { if (!dname.trim()) setAdding(false) }}
          />
        )}
        {docs.map(n => <DocNode key={n.path} node={n} active={docPath} onSelect={setDoc} />)}
        {!docs.length && !adding && <span className={styles.empty}>No documents yet</span>}
      </div>

      <div className={styles.section}>
        <div className={styles.header}>
          <span className={styles.label}>Canvas boards</span>
          <button className={styles.addBtn} onClick={addBoard}>+</button>
        </div>
        <button
          className={`${styles.row} ${view === 'board' && boardFile === 'master.json' ? styles.boardActive : ''}`}
          onClick={() => openBoard('master.json', false)}
        >
          ◎ Master board
        </button>
        {boards.filter(b => !b.isMaster).map(b => (
          <button
            key={b.file}
            className={`${styles.row} ${view === 'board' && boardFile === b.file ? styles.boardActive : ''}`}
            onClick={() => openBoard(b.file, false)}
          >
            ⊞ <span className={styles.boardName}>{b.name}</span>
            <span className={styles.boardCount}>{(b.nodes || []).length}</span>
          </button>
        ))}
      </div>

      <div className={styles.footer}>
        <button className={styles.pathBtn} onClick={() => window.api.shell.open(project.dir)} title={project.dir}>
          ⌂ <span>{project.dir.split('/').pop()}</span>
        </button>
      </div>
    </aside>
  )
}

function DocNode({ node, active, onSelect }) {
  const [open, setOpen] = useState(true)
  const s = require('./Sidebar.module.css').default

  if (node.type === 'folder') return (
    <div>
      <button className={s.row} onClick={() => setOpen(o => !o)}>{open ? '▾' : '▸'} 📁 {node.name}</button>
      {open && <div className={s.indent}>{node.children.map(c => <DocNode key={c.path} node={c} active={active} onSelect={onSelect} />)}</div>}
    </div>
  )
  return (
    <button className={`${s.row} ${active === node.path ? s.active : ''}`} onClick={() => onSelect(node.path)}>
      📄 {node.name}
    </button>
  )
}
