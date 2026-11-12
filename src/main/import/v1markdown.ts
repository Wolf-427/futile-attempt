import type { BlockNode, DocJSON, InlineNode, MarkType } from '@shared/content'
import { htmlToBlocks, pushText } from './html'

// Private-use characters stand in for mark boundaries while the text is scanned.
const OPEN: Record<string, MarkType> = { '': 'bold', '': 'italic', '': 'strike' }
const CLOSE: Record<string, MarkType> = { '': 'bold', '': 'italic', '': 'strike' }

/**
 * v1 inline syntax: **bold**, *italic*, ~~strike~~. Underline was never saved.
 * A lone asterisk followed by a space ("2 * 3 * 4") stays a literal asterisk;
 * v1 turned that into italics when it reloaded the file.
 */
export function parseInline(text: string): InlineNode[] {
  const tagged = text
    .replace(/[-]/g, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*(?=\S)([^*]+)\*/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')

  const out: InlineNode[] = []
  const marks = new Set<MarkType>()
  let run = ''
  const flush = (): void => {
    pushText(out, run, marks)
    run = ''
  }
  for (const ch of tagged) {
    const open = OPEN[ch]
    const close = CLOSE[ch]
    if (open) {
      flush()
      marks.add(open)
    } else if (close) {
      flush()
      marks.delete(close)
    } else if (ch === '\n') {
      flush()
      out.push({ type: 'hardBreak' })
    } else {
      run += ch
    }
  }
  flush()
  return out
}

function textBlock(type: 'paragraph', text: string, indent?: number): BlockNode
function textBlock(type: 'heading', text: string, level: 1 | 2 | 3): BlockNode
function textBlock(type: 'paragraph' | 'heading', text: string, extra?: number): BlockNode {
  const content = parseInline(text)
  if (type === 'heading') {
    const node: BlockNode = { type: 'heading', attrs: { level: (extra ?? 1) as 1 | 2 | 3 } }
    if (content.length) node.content = content
    return node
  }
  const node: BlockNode = { type: 'paragraph' }
  if (extra) node.attrs = { indent: extra }
  if (content.length) node.content = content
  return node
}

const INDENTED = /^<p style="padding-left:\s*([\d.]+)px;?\s*">([\s\S]*)<\/p>$/

/**
 * Convert a v1 document (.md in Scriptum's own dialect) to document JSON.
 *
 * The dialect: `#`..`###` headings, `> ` quotes, `---PAGE---` page breaks,
 * blank-line separated paragraphs, lists as raw `<ul>`/`<ol>` HTML and
 * indented paragraphs as `<p style="padding-left:…">`.
 *
 * Beyond what v1 itself restored on load, this recovers manual page breaks,
 * line breaks inside paragraphs, text containing `<`, and blockquotes that
 * collected extra `>` markers.
 */
export function v1MarkdownToDoc(markdown: string): DocJSON {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
  const blocks: BlockNode[] = []
  let para: string[] = []
  const flush = (): void => {
    if (para.length) blocks.push(textBlock('paragraph', para.join('\n')))
    para = []
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ''

    if (line.trim() === '') {
      flush()
      continue
    }
    if (line === '---PAGE---') {
      flush()
      blocks.push({ type: 'pageBreak' })
      continue
    }

    const heading = /^(#{1,3}) (.+)$/.exec(line)
    if (heading) {
      flush()
      blocks.push(textBlock('heading', heading[2] ?? '', (heading[1] ?? '#').length as 1 | 2 | 3))
      continue
    }

    if (/^>/.test(line)) {
      flush()
      const content: BlockNode[] = []
      for (; i < lines.length && /^>/.test(lines[i] ?? ''); i++) {
        const text = (lines[i] ?? '').replace(/^(>\s*)+/, '')
        if (text.trim()) content.push(textBlock('paragraph', text))
      }
      i--
      if (content.length) blocks.push({ type: 'blockquote', content })
      continue
    }

    if (/^<(ul|ol)[\s>]/.test(line)) {
      flush()
      let html = ''
      let depth = 0
      for (; i < lines.length; i++) {
        const part = lines[i] ?? ''
        html += (html ? '\n' : '') + part
        depth += (part.match(/<(ul|ol)[\s>]/g) ?? []).length - (part.match(/<\/(ul|ol)>/g) ?? []).length
        if (depth <= 0) break
      }
      blocks.push(...htmlToBlocks(html))
      continue
    }

    if (/^<p style="padding-left:/.test(line)) {
      let html = line
      let end = i
      while (!html.endsWith('</p>') && end + 1 < lines.length && (lines[end + 1] ?? '').trim() !== '') {
        html += '\n' + (lines[++end] ?? '')
      }
      const m = INDENTED.exec(html)
      if (m) {
        flush()
        blocks.push(textBlock('paragraph', m[2] ?? '', parseFloat(m[1] ?? '0')))
        i = end
        continue
      }
    }

    para.push(line)
  }
  flush()

  return { type: 'doc', content: blocks.length ? blocks : [{ type: 'paragraph' }] }
}
