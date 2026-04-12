import React, { useEffect, useState } from 'react'
import { v4 as uuid } from 'uuid'
import styles from './Pins.module.css'

export default function SubPin({ node, onDrag, onOpen, onChange, onDelete, projectDir }) {
  const [cover, setCover] = useState(null)
  const [renaming, setRenaming] = useState(false)
  const [nameVal, setNameVal] = useState(node.name)

  useEffect(() => {
    if (!node.cover) return
    window.api.fs.readBin(node.cover)
      .then(b => setCover(`data:image/jpeg;base64,${b}`))
      .catch(() => {})
  }, [node.cover])

  async function setCoverImg() {
    const fp = await window.api.dialog.file([{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif'] }])
    if (!fp) return
    const dest = `${projectDir}/references/cover-${uuid()}-${fp.split('/').pop()}`
    await window.api.fs.copy(fp, dest)
    onChange({ cover: dest })
  }

  function finishRename() {
    if (nameVal.trim()) onChange({ name: nameVal.trim() })
    setRenaming(false)
  }

  return (
    <div
      className={styles.subPin}
      style={{ left: node.x, top: node.y }}
      onMouseDown={onDrag}
      onDoubleClick={e => { e.stopPropagation(); onOpen() }}
    >
      <div className={styles.subCover}>
        {cover
          ? <img src={cover} alt="" className={styles.subCoverImg} draggable={false} />
          : <span className={styles.subCoverIcon}>⊞</span>
        }
      </div>
      <div className={styles.subFoot}>
        {renaming ? (
          <input
            autoFocus
            className={styles.subRename}
            value={nameVal}
            onChange={e => setNameVal(e.target.value)}
            onBlur={finishRename}
            onKeyDown={e => { if (e.key === 'Enter') finishRename(); if (e.key === 'Escape') setRenaming(false) }}
            onMouseDown={e => e.stopPropagation()}
          />
        ) : (
          <span className={styles.subName}>{node.name}</span>
        )}
      </div>
      <div className={styles.subActions} onMouseDown={e => e.stopPropagation()}>
        <button className={styles.subAct} onClick={() => setRenaming(true)}>✎</button>
        <button className={styles.subAct} onClick={setCoverImg}>⊡</button>
        <button className={`${styles.subAct} ${styles.subDel}`} onClick={onDelete}>×</button>
      </div>
      <div className={styles.subHint}>Double-click to open</div>
    </div>
  )
}
