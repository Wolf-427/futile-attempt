import React, { useEffect, useState, useRef, useCallback } from 'react'
import { useStore } from '../../store'
import { saveBoard, newBoard } from '../../services/project'
import { v4 as uuid } from 'uuid'
import styles from './Board.module.css'
import NotePin from './NotePin'
import ImagePin from './ImagePin'
import SubPin from './SubPin'

const MIN_ZOOM = 0.15
const MAX_ZOOM = 3

export default function Board({ project }) {
  const { boardFile, openBoard, boardStack, boardBack, setGit } = useStore()
  const [board, setBoard] = useState(null)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 80, y: 80 })
  const panning = useRef(false)
  const lastMouse = useRef({ x: 0, y: 0 })
  const dragging = useRef(null)
  const dragOffset = useRef({ x: 0, y: 0 })
  const areaRef = useRef(null)

  useEffect(() => {
    if (!project?.dir || !boardFile) return
    window.api.fs.read(`${project.dir}/boards/${boardFile}`)
      .then(r => setBoard(JSON.parse(r)))
      .catch(() => setBoard({ name: 'Board', nodes: [] }))
  }, [project?.dir, boardFile])

  const persist = useCallback(async (b) => {
    await saveBoard(project.dir, boardFile, b)
    setGit({ dirty: true })
  }, [project?.dir, boardFile])

  function updateNodes(nodes) {
    const b = { ...board, nodes }
    setBoard(b)
    persist(b)
  }

  function onMouseDown(e) {
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      panning.current = true
      lastMouse.current = { x: e.clientX, y: e.clientY }
      e.preventDefault()
    }
  }

  function onMouseMove(e) {
    if (panning.current) {
      setPan(p => ({ x: p.x + e.clientX - lastMouse.current.x, y: p.y + e.clientY - lastMouse.current.y }))
      lastMouse.current = { x: e.clientX, y: e.clientY }
    }
    if (dragging.current && board) {
      const r = areaRef.current.getBoundingClientRect()
      const x = (e.clientX - r.left - pan.x) / zoom - dragOffset.current.x
      const y = (e.clientY - r.top  - pan.y) / zoom - dragOffset.current.y
      setBoard(b => ({ ...b, nodes: b.nodes.map(n => n.id === dragging.current ? { ...n, x: Math.round(x), y: Math.round(y) } : n) }))
    }
  }

  function onMouseUp() {
    panning.current = false
    if (dragging.current && board) persist(board)
    dragging.current = null
  }

  function onWheel(e) {
    e.preventDefault()
    setZoom(z => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z - e.deltaY * 0.001 * z)))
  }

  async function onDrop(e) {
    e.preventDefault()
    const file = e.dataTransfer.files?.[0]
    if (!file?.type.startsWith('image/')) return
    const r = areaRef.current.getBoundingClientRect()
    const x = Math.round((e.clientX - r.left - pan.x) / zoom)
    const y = Math.round((e.clientY - r.top  - pan.y) / zoom)
    const dest = `${project.dir}/references/${uuid()}-${file.name}`
    await window.api.fs.copy(file.path, dest)
    updateNodes([...board.nodes, { id: uuid(), type: 'image', x, y, width: 240, src: dest }])
  }

  function startDrag(e, id) {
    if (e.button !== 0) return
    e.stopPropagation()
    const node = board.nodes.find(n => n.id === id)
    if (!node) return
    const r = areaRef.current.getBoundingClientRect()
    dragging.current = id
    dragOffset.current = { x: (e.clientX - r.left - pan.x) / zoom - node.x, y: (e.clientY - r.top - pan.y) / zoom - node.y }
  }

  function addNote(color) {
    const x = Math.round((-pan.x + 400) / zoom)
    const y = Math.round((-pan.y + 300) / zoom)
    updateNodes([...board.nodes, { id: uuid(), type: 'note', color, x: x - 100, y: y - 80, width: 200, text: '' }])
  }

  async function addSubBoard() {
    const count = (board?.nodes || []).filter(n => n.type === 'subboard').length
    const b = await newBoard(project.dir, `Board ${count + 1}`)
    const x = Math.round((-pan.x + 400) / zoom)
    const y = Math.round((-pan.y + 300) / zoom)
    updateNodes([...board.nodes, { id: uuid(), type: 'subboard', x: x - 80, y: y - 70, file: b.file, name: b.name, cover: null }])
  }

  function update(id, patch) { updateNodes(board.nodes.map(n => n.id === id ? { ...n, ...patch } : n)) }
  function remove(id)        { updateNodes(board.nodes.filter(n => n.id !== id)) }

  if (!board) return <div className={styles.loading}>Loading…</div>

  const colors = [
    { c: 'yellow', bg: 'var(--ny-bg)', b: 'var(--ny-b)' },
    { c: 'blue',   bg: 'var(--nb-bg)', b: 'var(--nb-b)' },
    { c: 'green',  bg: 'var(--ng-bg)', b: 'var(--ng-b)' },
    { c: 'purple', bg: 'var(--np-bg)', b: 'var(--np-b)' },
  ]

  return (
    <div className={styles.root}>
      <div className={styles.toolbar}>
        {boardStack.length > 0 && (
          <button className={styles.tbtn} onClick={boardBack}>← Back</button>
        )}
        <span className={styles.boardName}>{board.name}</span>
        <div className={styles.sep} />
        {colors.map(({ c, bg, b }) => (
          <button key={c} className={styles.colorDot} style={{ background: bg, borderColor: b }} title={`${c} note`} onClick={() => addNote(c)} />
        ))}
        <button className={styles.tbtn} onClick={addSubBoard}>⊞ Sub-board</button>
        <div style={{ flex: 1 }} />
        <span className={styles.zoomLabel}>{Math.round(zoom * 100)}%</span>
        <button className={styles.tbtn} onClick={() => setZoom(z => Math.max(MIN_ZOOM, z - 0.1))}>−</button>
        <button className={styles.tbtn} onClick={() => { setZoom(1); setPan({ x: 80, y: 80 }) }}>⌂</button>
        <button className={styles.tbtn} onClick={() => setZoom(z => Math.min(MAX_ZOOM, z + 0.1))}>+</button>
      </div>

      <div
        ref={areaRef}
        className={styles.area}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
        onWheel={onWheel}
        onDrop={onDrop}
        onDragOver={e => e.preventDefault()}
      >
        <div className={styles.world} style={{ transform: `translate(${pan.x}px,${pan.y}px) scale(${zoom})` }}>
          {board.nodes.map(node => {
            if (node.type === 'note')     return <NotePin  key={node.id} node={node} onDrag={e => startDrag(e, node.id)} onChange={p => update(node.id, p)} onDelete={() => remove(node.id)} />
            if (node.type === 'image')    return <ImagePin key={node.id} node={node} onDrag={e => startDrag(e, node.id)} onDelete={() => remove(node.id)} />
            if (node.type === 'subboard') return <SubPin   key={node.id} node={node} onDrag={e => startDrag(e, node.id)} onOpen={() => openBoard(node.file)} onChange={p => update(node.id, p)} onDelete={() => remove(node.id)} projectDir={project.dir} />
            return null
          })}
        </div>
      </div>

      <div className={styles.hint}>Alt+drag or middle-click to pan · Scroll to zoom · Drop images onto canvas</div>
    </div>
  )
}
