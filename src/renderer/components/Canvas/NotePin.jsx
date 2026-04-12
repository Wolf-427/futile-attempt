import React from 'react'
import styles from './Pins.module.css'

const COLOR_MAP = {
  yellow: styles.yellow,
  blue:   styles.blue,
  green:  styles.green,
  purple: styles.purple,
}

export default function NotePin({ node, onDrag, onChange, onDelete }) {
  return (
    <div
      className={`${styles.pin} ${COLOR_MAP[node.color] || styles.yellow}`}
      style={{ left: node.x, top: node.y, width: node.width }}
      onMouseDown={onDrag}
    >
      <div className={styles.bar}>
        <span className={styles.label}>Note</span>
        <button className={styles.del} onMouseDown={e => e.stopPropagation()} onClick={onDelete}>×</button>
      </div>
      <textarea
        className={styles.noteText}
        value={node.text}
        placeholder="Type a note…"
        onMouseDown={e => e.stopPropagation()}
        onChange={e => onChange({ text: e.target.value })}
      />
    </div>
  )
}
