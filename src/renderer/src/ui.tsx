import { useEffect, useRef, useState, type ReactNode } from 'react'

/** A text field that edits a name in place. Enter or blur commits, Escape cancels. */
export function InlineEdit(props: {
  value: string
  onCommit(value: string): void
  onCancel(): void
  testId?: string
}) {
  const [value, setValue] = useState(props.value)
  const ref = useRef<HTMLInputElement>(null)
  const done = useRef(false)

  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])

  const finish = (commit: boolean): void => {
    if (done.current) return
    done.current = true
    const next = value.trim()
    if (commit && next && next !== props.value) props.onCommit(next)
    else props.onCancel()
  }

  return (
    <input
      ref={ref}
      className="inline-edit"
      data-testid={props.testId}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => finish(true)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') finish(true)
        if (e.key === 'Escape') finish(false)
      }}
    />
  )
}

export function Modal(props: { title: string; onClose(): void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') props.onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [props])

  return (
    <div className="modal-backdrop" onMouseDown={props.onClose}>
      <div className="modal" role="dialog" aria-label={props.title} onMouseDown={(e) => e.stopPropagation()}>
        <h2>{props.title}</h2>
        {props.children}
      </div>
    </div>
  )
}

export function Confirm(props: {
  title: string
  detail: string
  confirmLabel: string
  onConfirm(): void
  onClose(): void
}) {
  return (
    <Modal title={props.title} onClose={props.onClose}>
      <p className="modal-detail">{props.detail}</p>
      <div className="modal-actions">
        <button className="btn" onClick={props.onClose}>
          Cancel
        </button>
        <button
          className="btn btn-danger"
          data-testid="confirm"
          onClick={() => {
            props.onConfirm()
            props.onClose()
          }}
        >
          {props.confirmLabel}
        </button>
      </div>
    </Modal>
  )
}

export interface MenuItem {
  label: string
  danger?: boolean
  onSelect(): void
}

export interface MenuState {
  x: number
  y: number
  items: MenuItem[]
}

export function ContextMenu(props: { menu: MenuState; onClose(): void }) {
  useEffect(() => {
    const close = (): void => props.onClose()
    window.addEventListener('mousedown', close)
    window.addEventListener('blur', close)
    window.addEventListener('keydown', close)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('blur', close)
      window.removeEventListener('keydown', close)
    }
  }, [props])

  const x = Math.min(props.menu.x, window.innerWidth - 200)
  const y = Math.min(props.menu.y, window.innerHeight - props.menu.items.length * 30 - 12)
  return (
    <div className="menu" style={{ left: x, top: y }} onMouseDown={(e) => e.stopPropagation()}>
      {props.menu.items.map((item) => (
        <button
          key={item.label}
          className={item.danger ? 'menu-item danger' : 'menu-item'}
          onClick={() => {
            props.onClose()
            item.onSelect()
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}

export function CloudBadge(props: { state: string | undefined }) {
  if (!props.state || props.state === 'local') return null
  const label =
    props.state === 'cloud'
      ? 'In the cloud, not downloaded'
      : props.state === 'downloading'
        ? 'Downloading from the cloud'
        : props.state === 'missing'
          ? 'File is missing'
          : 'Cannot be read right now'
  return (
    <span className={`badge badge-${props.state}`} title={label} aria-label={label}>
      {props.state === 'missing' || props.state === 'unavailable' ? '!' : '☁'}
    </span>
  )
}
