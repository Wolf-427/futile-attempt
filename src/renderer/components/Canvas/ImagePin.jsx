import React, { useEffect, useState } from 'react'
import styles from './Pins.module.css'

export default function ImagePin({ node, onDrag, onDelete }) {
  const [src, setSrc] = useState(null)

  useEffect(() => {
    window.api.fs.readBin(node.src)
      .then(b => setSrc(`data:image/jpeg;base64,${b}`))
      .catch(() => {})
  }, [node.src])

  return (
    <div
      className={`${styles.pin} ${styles.imgPin}`}
      style={{ left: node.x, top: node.y, width: node.width }}
      onMouseDown={onDrag}
    >
      <div className={styles.bar}>
        <span className={`${styles.label} ${styles.imgLabel}`}>Image</span>
        <button className={styles.del} onMouseDown={e => e.stopPropagation()} onClick={onDelete}>×</button>
      </div>
      {src
        ? <img src={src} alt="" className={styles.img} draggable={false} />
        : <div className={styles.imgLoading}>Loading…</div>
      }
    </div>
  )
}
