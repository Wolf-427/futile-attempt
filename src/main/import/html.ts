import { parseFragment, type DefaultTreeAdapterMap } from 'parse5'
import type { Align, BlockNode, InlineNode, ListItemNode, Mark, MarkType } from '@shared/content'

type Node = DefaultTreeAdapterMap['childNode']
type Element = DefaultTreeAdapterMap['element']

const MARK_TAGS: Record<string, MarkType> = {
  strong: 'bold',
  b: 'bold',
  em: 'italic',
  i: 'italic',
  u: 'underline',
  s: 'strike',
  strike: 'strike',
  del: 'strike'
}
const BLOCK_TAGS = new Set([
  'p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'ul', 'ol', 'li', 'hr', 'pre'
])
const MARK_ORDER: MarkType[] = ['bold', 'italic', 'underline', 'strike']

function isElement(node: Node): node is Element {
  return 'tagName' in node
}

function attr(el: Element, name: string): string | undefined {
  return el.attrs.find((a) => a.name === name)?.value
}

function styleOf(el: Element): Record<string, string> {
  const out: Record<string, string> = {}
  for (const part of (attr(el, 'style') ?? '').split(';')) {
    const i = part.indexOf(':')
    if (i > 0) out[part.slice(0, i).trim().toLowerCase()] = part.slice(i + 1).trim()
  }
  return out
}

function alignOf(el: Element): Align | undefined {
  const v = styleOf(el)['text-align']
  return v === 'left' || v === 'center' || v === 'right' || v === 'justify' ? v : undefined
}

function indentOf(el: Element): number | undefined {
  const px = parseFloat(styleOf(el)['padding-left'] ?? '')
  return Number.isFinite(px) && px > 0 ? px : undefined
}

function marksArray(set: ReadonlySet<MarkType>): Mark[] | undefined {
  const marks = MARK_ORDER.filter((m) => set.has(m)).map((type) => ({ type }))
  return marks.length ? marks : undefined
}

/** Append text, merging with the previous run when the marks are the same. */
export function pushText(out: InlineNode[], text: string, marks: ReadonlySet<MarkType>): void {
  if (!text) return
  const m = marksArray(marks)
  const last = out[out.length - 1]
  if (last?.type === 'text' && JSON.stringify(last.marks) === JSON.stringify(m)) {
    last.text += text
    return
  }
  out.push(m ? { type: 'text', text, marks: m } : { type: 'text', text })
}

function collectInline(nodes: Node[], marks: ReadonlySet<MarkType>, out: InlineNode[]): void {
  for (const node of nodes) {
    if (node.nodeName === '#text' && 'value' in node) {
      pushText(out, node.value.replace(/ /g, ' ').replace(/\s*\n\s*/g, ' '), marks)
    } else if (isElement(node)) {
      if (node.tagName === 'br') {
        out.push({ type: 'hardBreak' })
        continue
      }
      const next = new Set(marks)
      const mark = MARK_TAGS[node.tagName]
      if (mark) next.add(mark)
      const style = styleOf(node)
      const weight = style['font-weight']
      if (weight === 'bold' || Number(weight) >= 600) next.add('bold')
      if (style['font-style'] === 'italic') next.add('italic')
      if ((style['text-decoration'] ?? '').includes('underline')) next.add('underline')
      if ((style['text-decoration'] ?? '').includes('line-through')) next.add('strike')
      collectInline(node.childNodes, next, out)
    }
  }
}

function trimBreaks(inline: InlineNode[]): InlineNode[] {
  const out = [...inline]
  // A lone <br> is how browsers mark an empty line; it carries no content.
  while (out.length && out[out.length - 1]?.type === 'hardBreak') out.pop()
  return out
}

function paragraph(inline: InlineNode[], el?: Element): BlockNode {
  const content = trimBreaks(inline)
  const attrs: { textAlign?: Align; indent?: number } = {}
  const align = el && alignOf(el)
  const indent = el && indentOf(el)
  if (align) attrs.textAlign = align
  if (indent) attrs.indent = indent
  const node: BlockNode = { type: 'paragraph' }
  if (Object.keys(attrs).length) node.attrs = attrs
  if (content.length) node.content = content
  return node
}

function hasBlockChild(el: Element): boolean {
  return el.childNodes.some((c) => isElement(c) && BLOCK_TAGS.has(c.tagName))
}

function listItems(el: Element): ListItemNode[] {
  const items: ListItemNode[] = []
  for (const child of el.childNodes) {
    if (!isElement(child) || child.tagName !== 'li') continue
    const content = collectBlocks(child.childNodes)
    items.push({ type: 'listItem', content: content.length ? content : [{ type: 'paragraph' }] })
  }
  return items
}

function collectBlocks(nodes: Node[]): BlockNode[] {
  const out: BlockNode[] = []
  let loose: Node[] = []
  const flushLoose = (): void => {
    if (!loose.length) return
    const inline: InlineNode[] = []
    collectInline(loose, new Set(), inline)
    loose = []
    const para = paragraph(inline)
    if (para.type === 'paragraph' && para.content) out.push(para)
  }

  for (const node of nodes) {
    if (!isElement(node) || !BLOCK_TAGS.has(node.tagName)) {
      loose.push(node)
      continue
    }
    flushLoose()
    const tag = node.tagName
    if (tag === 'hr' || attr(node, 'data-type') === 'pageBreak') {
      out.push({ type: 'pageBreak' })
    } else if (tag === 'ul' || tag === 'ol') {
      const content = listItems(node)
      if (content.length) out.push({ type: tag === 'ul' ? 'bulletList' : 'orderedList', content })
    } else if (tag === 'blockquote') {
      const content = collectBlocks(node.childNodes)
      if (content.length) out.push({ type: 'blockquote', content })
    } else if (/^h[1-6]$/.test(tag)) {
      const inline: InlineNode[] = []
      collectInline(node.childNodes, new Set(), inline)
      const level = Math.min(3, Number(tag[1])) as 1 | 2 | 3
      const align = alignOf(node)
      const heading: BlockNode = { type: 'heading', attrs: align ? { level, textAlign: align } : { level } }
      const content = trimBreaks(inline)
      if (content.length) heading.content = content
      out.push(heading)
    } else if (hasBlockChild(node)) {
      out.push(...collectBlocks(node.childNodes))
    } else {
      const inline: InlineNode[] = []
      collectInline(node.childNodes, new Set(), inline)
      out.push(paragraph(inline, node))
    }
  }
  flushLoose()
  return out
}

/** Convert an HTML fragment (v1 list markup, v1 canvas note content) to document blocks. */
export function htmlToBlocks(html: string): BlockNode[] {
  return collectBlocks(parseFragment(html).childNodes)
}
