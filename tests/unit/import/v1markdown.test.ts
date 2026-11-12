import { describe, expect, it } from 'vitest'
import { htmlToBlocks } from '../../../src/main/import/html'
import { parseInline, v1MarkdownToDoc } from '../../../src/main/import/v1markdown'

const text = (t: string, ...marks: string[]) =>
  marks.length ? { type: 'text', text: t, marks: marks.map((type) => ({ type })) } : { type: 'text', text: t }
const p = (...content: unknown[]) => (content.length ? { type: 'paragraph', content } : { type: 'paragraph' })
const blocks = (md: string) => v1MarkdownToDoc(md).content

describe('v1 inline syntax', () => {
  it('reads bold, italic and strike, including nesting', () => {
    expect(parseInline('a **b** *c* ~~d~~ e')).toEqual([
      text('a '), text('b', 'bold'), text(' '), text('c', 'italic'), text(' '), text('d', 'strike'), text(' e')
    ])
    expect(parseInline('***both***')).toEqual([text('both', 'bold', 'italic')])
    expect(parseInline('~~**x** y~~')).toEqual([text('x', 'bold', 'strike'), text(' y', 'strike')])
  })

  it('keeps literal asterisks and angle brackets that v1 mangled on reload', () => {
    expect(parseInline('2 * 3 * 4 = 24')).toEqual([text('2 * 3 * 4 = 24')])
    expect(parseInline('if a<b then c>d')).toEqual([text('if a<b then c>d')])
  })

  it('turns line breaks inside a paragraph into hard breaks', () => {
    expect(parseInline('**Location:** \n**Time:** ')).toEqual([
      text('Location:', 'bold'), text(' '), { type: 'hardBreak' }, text('Time:', 'bold'), text(' ')
    ])
  })
})

describe('v1 document dialect', () => {
  it('reads headings and paragraphs, also when only one newline separates them', () => {
    expect(blocks('# Title\n\nFirst paragraph.\n## Scene\nSecond.\n')).toEqual([
      { type: 'heading', attrs: { level: 1 }, content: [text('Title')] },
      p(text('First paragraph.')),
      { type: 'heading', attrs: { level: 2 }, content: [text('Scene')] },
      p(text('Second.'))
    ])
  })

  it('restores manual page breaks, which v1 lost on reload', () => {
    expect(blocks('Before.\n---PAGE---\nAfter.\n')).toEqual([p(text('Before.')), { type: 'pageBreak' }, p(text('After.'))])
  })

  it('strips the extra > markers v1 added to blockquotes on every save', () => {
    expect(blocks('> > > A quote\n> > > second paragraph\n\nNormal.\n')).toEqual([
      { type: 'blockquote', content: [p(text('A quote')), p(text('second paragraph'))] },
      p(text('Normal.'))
    ])
  })

  it('reads lists stored as raw HTML, with marks and nesting', () => {
    const md = 'Intro\n\n<ul><li><p>one <strong>bold</strong></p></li><li><p>two</p><ol><li><p>nested</p></li></ol></li></ul>\n\nOutro\n'
    expect(blocks(md)).toEqual([
      p(text('Intro')),
      {
        type: 'bulletList',
        content: [
          { type: 'listItem', content: [p(text('one '), text('bold', 'bold'))] },
          { type: 'listItem', content: [p(text('two')), { type: 'orderedList', content: [{ type: 'listItem', content: [p(text('nested'))] }] }] }
        ]
      },
      p(text('Outro'))
    ])
  })

  it('reads indented paragraphs', () => {
    expect(blocks('<p style="padding-left:40px">Indented *text*</p>\n')).toEqual([
      { type: 'paragraph', attrs: { indent: 40 }, content: [text('Indented '), text('text', 'italic')] }
    ])
  })

  it('treats a paragraph that merely starts with < as text', () => {
    expect(blocks('<3 this\n')).toEqual([p(text('<3 this'))])
  })

  it('gives an empty file one empty paragraph', () => {
    expect(v1MarkdownToDoc('')).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] })
    expect(v1MarkdownToDoc('\n\n \n')).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] })
  })
})

describe('canvas note HTML', () => {
  it('reads contenteditable markup without keeping any HTML', () => {
    expect(htmlToBlocks('Line one<div>Line <b>two</b></div><div><br></div><div><span style="font-weight: 700">three</span></div>')).toEqual([
      p(text('Line one')),
      p(text('Line '), text('two', 'bold')),
      p(),
      p(text('three', 'bold'))
    ])
    expect(JSON.stringify(htmlToBlocks('<img src=x onerror=alert(1)><script>alert(2)</script>ok'))).not.toMatch(/onerror|script/)
  })
})
