/** Shapes of the item files in a format 2 project. */

// ── Documents ──────────────────────────────────────────────────────────────
// The document body is Tiptap/ProseMirror JSON, saved exactly as the editor holds it.

export type MarkType = 'bold' | 'italic' | 'underline' | 'strike'
export interface Mark {
  type: MarkType
}

export type InlineNode = { type: 'text'; text: string; marks?: Mark[] } | { type: 'hardBreak' }

export type Align = 'left' | 'center' | 'right' | 'justify'

export type BlockNode =
  | { type: 'paragraph'; attrs?: { textAlign?: Align; indent?: number }; content?: InlineNode[] }
  | { type: 'heading'; attrs: { level: 1 | 2 | 3; textAlign?: Align }; content?: InlineNode[] }
  | { type: 'blockquote'; content: BlockNode[] }
  | { type: 'bulletList' | 'orderedList'; content: ListItemNode[] }
  | { type: 'pageBreak' }

export interface ListItemNode {
  type: 'listItem'
  content: BlockNode[]
}

export interface DocJSON {
  type: 'doc'
  content: BlockNode[]
}

export interface DocumentFile {
  doc: DocJSON
}

// ── Boards ─────────────────────────────────────────────────────────────────

interface NodeBase {
  id: string
  x: number
  y: number
  width: number
  height?: number
}

export type BoardNode =
  | (NodeBase & { type: 'note'; color: string; content: BlockNode[]; fontSize?: number; align?: Align })
  | (NodeBase & { type: 'text'; content: BlockNode[]; fontSize?: number; align?: Align })
  /** `asset` is a path relative to the project's assets folder. */
  | (NodeBase & { type: 'image'; asset: string | null; aspectRatio?: number })
  | (NodeBase & { type: 'subboard'; boardId: string | null; title: string; cover: string | null })
  | (NodeBase & { type: 'doclink'; documentId: string | null; title: string })
  | (NodeBase & { type: 'group'; name: string; members: string[] })

export interface BoardEdge {
  id: string
  source: string
  target: string
  color?: string
  dashed?: boolean
}

export interface BoardFile {
  isMaster: boolean
  nodes: BoardNode[]
  edges: BoardEdge[]
  viewport: { x: number; y: number; zoom: number }
}

// ── Characters ─────────────────────────────────────────────────────────────

export const CHARACTER_TEXT_FIELDS = [
  'role',
  'description',
  'notes',
  'age',
  'pronouns',
  'occupation',
  'origin',
  'height',
  'build',
  'hair',
  'eyes',
  'traits'
] as const

export type CharacterTextField = (typeof CHARACTER_TEXT_FIELDS)[number]

export type CharacterFile = Partial<Record<CharacterTextField, string>> & {
  /** Paths relative to the project's assets folder. */
  image: string | null
  refImages: string[]
  created: number
}

// ── Helpers ────────────────────────────────────────────────────────────────

export function inlineText(nodes: InlineNode[] | undefined): string {
  return (nodes ?? []).map((n) => (n.type === 'text' ? n.text : '\n')).join('')
}

/** Plain text of a block list, one line per text block. Used for counts and checks. */
export function blocksText(blocks: BlockNode[]): string {
  const out: string[] = []
  const walk = (list: BlockNode[]): void => {
    for (const b of list) {
      if (b.type === 'paragraph' || b.type === 'heading') out.push(inlineText(b.content))
      else if (b.type === 'blockquote') walk(b.content)
      else if (b.type === 'bulletList' || b.type === 'orderedList') {
        for (const item of b.content) walk(item.content)
      }
    }
  }
  walk(blocks)
  return out.join('\n')
}
