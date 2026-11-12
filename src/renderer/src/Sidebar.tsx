import { useState, type DragEvent, type MouseEvent } from 'react'
import type { IndexEntry, ItemKind, TreeNode } from '@shared/project'
import { useApp } from './store'
import { CloudBadge, Confirm, ContextMenu, InlineEdit, type MenuState } from './ui'

const DRAG_TYPE = 'application/x-scriptum-row'
type Where = 'before' | 'after' | 'into'
interface DropTarget {
  id: string
  where: Where
}

interface Located {
  node: TreeNode
  parentId: string | null
  index: number
}

function locate(tree: TreeNode[], id: string, parentId: string | null = null): Located | null {
  for (const [index, node] of tree.entries()) {
    if (node.id === id) return { node, parentId, index }
    if (node.type === 'folder') {
      const hit = locate(node.children, id, node.id)
      if (hit) return hit
    }
  }
  return null
}

/** Which third of the row the pointer is over decides where a drop lands. */
function whereOver(e: DragEvent, allowInto: boolean): Where {
  const rect = e.currentTarget.getBoundingClientRect()
  const ratio = (e.clientY - rect.top) / rect.height
  if (allowInto) return ratio < 0.3 ? 'before' : ratio > 0.7 ? 'after' : 'into'
  return ratio < 0.5 ? 'before' : 'after'
}

const NEW_TITLE: Record<ItemKind, string> = {
  documents: 'Untitled',
  boards: 'New board',
  characters: 'New character'
}
const SECTION_LABEL: Record<ItemKind, string> = {
  documents: 'Documents',
  boards: 'Boards',
  characters: 'Characters'
}
const SINGULAR: Record<ItemKind, string> = { documents: 'document', boards: 'board', characters: 'character' }

export function Sidebar() {
  const project = useApp((s) => s.project)
  const view = useApp((s) => s.view)
  const selected = useApp((s) => s.selected)
  const renaming = useApp((s) => s.renaming)
  const { mutate, select, startRename } = useApp.getState()

  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [drop, setDrop] = useState<DropTarget | null>(null)
  const [dragging, setDragging] = useState<string | null>(null)
  const [trashOpen, setTrashOpen] = useState(false)
  const [confirmEmpty, setConfirmEmpty] = useState(false)

  if (!project) return null
  const { manifest, states } = project

  const create = async (kind: ItemKind, parentId?: string): Promise<void> => {
    const base = { op: 'createItem', kind, title: NEW_TITLE[kind] } as const
    const id = await mutate(parentId ? { ...base, parentId } : base)
    if (!id) return
    if (parentId) setCollapsed((c) => new Set([...c].filter((x) => x !== parentId)))
    select({ kind, id })
    startRename(id)
  }

  const createFolder = async (parentId?: string): Promise<void> => {
    const base = { op: 'createFolder', title: 'New folder' } as const
    const id = await mutate(parentId ? { ...base, parentId } : base)
    if (id) startRename(id)
  }

  const openMenu = (e: MouseEvent, items: MenuState['items']): void => {
    e.preventDefault()
    e.stopPropagation()
    setMenu({ x: e.clientX, y: e.clientY, items })
  }

  // ── drag and drop ────────────────────────────────────────────────────────
  const dragProps = (id: string) => ({
    draggable: renaming !== id,
    onDragStart: (e: DragEvent) => {
      e.dataTransfer.setData(DRAG_TYPE, id)
      e.dataTransfer.effectAllowed = 'move'
      setDragging(id)
    },
    onDragEnd: () => {
      setDragging(null)
      setDrop(null)
    }
  })

  const overProps = (id: string, allowInto: boolean, onDrop: (dragged: string, where: Where) => void) => ({
    onDragOver: (e: DragEvent) => {
      if (!e.dataTransfer.types.includes(DRAG_TYPE) || dragging === id) return
      e.preventDefault()
      e.stopPropagation()
      const where = whereOver(e, allowInto)
      if (drop?.id !== id || drop.where !== where) setDrop({ id, where })
    },
    onDrop: (e: DragEvent) => {
      const dragged = e.dataTransfer.getData(DRAG_TYPE)
      e.preventDefault()
      e.stopPropagation()
      const where = whereOver(e, allowInto)
      setDrop(null)
      setDragging(null)
      if (dragged && dragged !== id) onDrop(dragged, where)
    }
  })

  const dropTreeNode = (dragged: string, targetId: string, where: Where): void => {
    const target = locate(manifest.tree, targetId)
    if (!target || !locate(manifest.tree, dragged)) return
    if (where === 'into' && target.node.type === 'folder') {
      void mutate({ op: 'move', id: dragged, parentId: target.node.id, index: target.node.children.length })
      setCollapsed((c) => new Set([...c].filter((x) => x !== targetId)))
    } else {
      void mutate({ op: 'move', id: dragged, parentId: target.parentId, index: target.index + (where === 'after' ? 1 : 0) })
    }
  }

  const rowClass = (id: string, active: boolean): string =>
    ['row', active ? 'active' : '', dragging === id ? 'dragging' : '', drop?.id === id ? `drop-${drop.where}` : '']
      .filter(Boolean)
      .join(' ')

  // ── rows ─────────────────────────────────────────────────────────────────
  const renderTree = (nodes: TreeNode[], depth: number): React.ReactNode =>
    nodes.map((node) => {
      const indent = { paddingLeft: 8 + depth * 14 }
      if (node.type === 'folder') {
        const open = !collapsed.has(node.id)
        return (
          <div key={node.id}>
            <div
              className={rowClass(node.id, false)}
              style={indent}
              data-testid="folder-row"
              {...dragProps(node.id)}
              {...overProps(node.id, true, (dragged, where) => dropTreeNode(dragged, node.id, where))}
              onClick={() =>
                setCollapsed((c) => {
                  const next = new Set(c)
                  if (!next.delete(node.id)) next.add(node.id)
                  return next
                })
              }
              onDoubleClick={() => startRename(node.id)}
              onContextMenu={(e) =>
                openMenu(e, [
                  { label: 'New document here', onSelect: () => void create('documents', node.id) },
                  { label: 'New folder here', onSelect: () => void createFolder(node.id) },
                  { label: 'Rename', onSelect: () => startRename(node.id) },
                  { label: 'Move to Trash', danger: true, onSelect: () => void mutate({ op: 'trash', target: 'folder', id: node.id }) }
                ])
              }
            >
              <span className="row-icon">{open ? '▾' : '▸'}</span>
              {renaming === node.id ? (
                <InlineEdit
                  testId="rename-input"
                  value={node.title}
                  onCancel={() => startRename(null)}
                  onCommit={(title) => {
                    startRename(null)
                    void mutate({ op: 'rename', target: 'folder', id: node.id, title })
                  }}
                />
              ) : (
                <span className="row-title">{node.title}</span>
              )}
            </div>
            {open && renderTree(node.children, depth + 1)}
          </div>
        )
      }
      return (
        <ItemRow
          key={node.id}
          kind="documents"
          entry={node}
          style={indent}
          className={rowClass(node.id, selected?.id === node.id)}
          state={states[`documents/${node.id}`]}
          handlers={{
            ...dragProps(node.id),
            ...overProps(node.id, false, (dragged, where) => dropTreeNode(dragged, node.id, where))
          }}
          openMenu={openMenu}
        />
      )
    })

  const renderIndex = (kind: 'boards' | 'characters', entries: IndexEntry[]): React.ReactNode =>
    entries.map((entry, index) => (
      <ItemRow
        key={entry.id}
        kind={kind}
        entry={entry}
        style={{ paddingLeft: 8 }}
        className={rowClass(entry.id, selected?.id === entry.id)}
        state={states[`${kind}/${entry.id}`]}
        handlers={{
          ...dragProps(entry.id),
          ...overProps(entry.id, false, (dragged, where) => {
            if (entries.some((e) => e.id === dragged)) {
              void mutate({ op: 'reorder', kind, id: dragged, index: index + (where === 'after' ? 1 : 0) })
            }
          })
        }}
        openMenu={openMenu}
      />
    ))

  const empty =
    view === 'documents' ? manifest.tree.length === 0 : manifest[view].length === 0

  return (
    <aside className="sidebar" data-testid="sidebar">
      <div
        className="sidebar-section sidebar-main"
        onContextMenu={(e) =>
          openMenu(e, [
            { label: `New ${SINGULAR[view]}`, onSelect: () => void create(view) },
            ...(view === 'documents' ? [{ label: 'New folder', onSelect: () => void createFolder() }] : [])
          ])
        }
        onDragOver={(e) => {
          if (view === 'documents' && e.dataTransfer.types.includes(DRAG_TYPE)) e.preventDefault()
        }}
        onDrop={(e) => {
          const dragged = e.dataTransfer.getData(DRAG_TYPE)
          setDrop(null)
          setDragging(null)
          if (view === 'documents' && dragged && locate(manifest.tree, dragged)) {
            void mutate({ op: 'move', id: dragged, parentId: null, index: manifest.tree.length })
          }
        }}
      >
        <div className="sidebar-header">
          <span className="sidebar-label">{SECTION_LABEL[view]}</span>
          <span>
            {view === 'documents' && (
              <button className="sidebar-add" data-testid="add-folder" title="New folder" onClick={() => void createFolder()}>
                ▤
              </button>
            )}
            <button className="sidebar-add" data-testid="add-item" title={`New ${SINGULAR[view]}`} onClick={() => void create(view)}>
              +
            </button>
          </span>
        </div>
        {view === 'documents' ? renderTree(manifest.tree, 0) : renderIndex(view, manifest[view])}
        {empty && <div className="sidebar-empty">Nothing here yet.</div>}
      </div>

      <div className="sidebar-section sidebar-trash">
        <div className="sidebar-header">
          <button className="sidebar-toggle" data-testid="trash-toggle" onClick={() => setTrashOpen((o) => !o)}>
            <span className="row-icon">{trashOpen ? '▾' : '▸'}</span>
            <span className="sidebar-label">Trash ({manifest.trash.length})</span>
          </button>
          {trashOpen && manifest.trash.length > 0 && (
            <button className="sidebar-add small" data-testid="empty-trash" onClick={() => setConfirmEmpty(true)}>
              Empty
            </button>
          )}
        </div>
        {trashOpen &&
          manifest.trash.map((t) => (
            <div key={t.id} className="row trash-row" data-testid="trash-row" style={{ paddingLeft: 8 }}>
              <span className="row-title">{t.title}</span>
              <button className="row-action" data-testid="restore" title="Put back" onClick={() => void mutate({ op: 'restore', id: t.id })}>
                ↩
              </button>
              <button className="row-action danger" title="Delete permanently" onClick={() => void mutate({ op: 'deleteFromTrash', id: t.id })}>
                ×
              </button>
            </div>
          ))}
      </div>

      <div className="sidebar-footer">
        <button className="sidebar-path" title="Show the project folder" onClick={() => void window.scriptum.project.reveal()}>
          <span>{project.dir}</span>
        </button>
      </div>

      {menu && <ContextMenu menu={menu} onClose={() => setMenu(null)} />}
      {confirmEmpty && (
        <Confirm
          title="Empty the trash?"
          detail={`${manifest.trash.length} item(s) will be deleted permanently. This cannot be undone.`}
          confirmLabel="Delete permanently"
          onClose={() => setConfirmEmpty(false)}
          onConfirm={() => void mutate({ op: 'deleteFromTrash' })}
        />
      )}
    </aside>
  )
}

function ItemRow(props: {
  kind: ItemKind
  entry: { id: string; title: string }
  className: string
  style: React.CSSProperties
  state: string | undefined
  handlers: Record<string, unknown>
  openMenu(e: MouseEvent, items: MenuState['items']): void
}) {
  const renaming = useApp((s) => s.renaming)
  const { mutate, select, startRename } = useApp.getState()
  const { kind, entry } = props

  return (
    <div
      className={props.className}
      style={props.style}
      data-testid="item-row"
      {...props.handlers}
      onClick={() => select({ kind, id: entry.id })}
      onDoubleClick={() => startRename(entry.id)}
      onContextMenu={(e) =>
        props.openMenu(e, [
          { label: 'Rename', onSelect: () => startRename(entry.id) },
          { label: 'Move to Trash', danger: true, onSelect: () => void mutate({ op: 'trash', target: kind, id: entry.id }) }
        ])
      }
    >
      <span className="row-icon">{kind === 'documents' ? '¶' : kind === 'boards' ? '▦' : '☺'}</span>
      {renaming === entry.id ? (
        <InlineEdit
          testId="rename-input"
          value={entry.title}
          onCancel={() => startRename(null)}
          onCommit={(title) => {
            startRename(null)
            void mutate({ op: 'rename', target: kind, id: entry.id, title })
          }}
        />
      ) : (
        <span className="row-title">{entry.title}</span>
      )}
      <CloudBadge state={props.state} />
    </div>
  )
}
