import { getSchema } from '@tiptap/core'
import { describe, expect, it } from 'vitest'
import { schemaExtensions } from '../../src/renderer/src/editor/extensions'
import { findMatches } from '../../src/renderer/src/editor/search'

const schema = getSchema(schemaExtensions())
const doc = (content: unknown[]) => schema.nodeFromJSON({ type: 'doc', content })
const text = (t: string, bold = false) => (bold ? { type: 'text', text: t, marks: [{ type: 'bold' }] } : { type: 'text', text: t })

describe('find', () => {
  it('finds a word that is partly bold and reports positions that select exactly it', () => {
    const d = doc([{ type: 'paragraph', content: [text('Ein '), text('Hu', true), text('nd und ein Hund')] }])
    const matches = findMatches(d, 'hund', false)
    expect(matches.map((m) => d.textBetween(m.from, m.to))).toEqual(['Hund', 'Hund'])
    expect(findMatches(d, 'hund', true)).toEqual([])
  })

  it('maps positions correctly after a line break and across blocks', () => {
    const d = doc([
      { type: 'heading', attrs: { level: 1 }, content: [text('Regen')] },
      { type: 'paragraph', content: [text('Erst'), { type: 'hardBreak' }, text('dann Regen')] },
      { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [text('Regen im Garten')] }] }] }
    ])
    const matches = findMatches(d, 'Regen', true)
    expect(matches).toHaveLength(3)
    for (const m of matches) expect(d.textBetween(m.from, m.to)).toBe('Regen')
  })

  it('does not match across a line break or between paragraphs', () => {
    const d = doc([
      { type: 'paragraph', content: [text('ab'), { type: 'hardBreak' }, text('cd')] },
      { type: 'paragraph', content: [text('ef')] }
    ])
    expect(findMatches(d, 'bc', false)).toEqual([])
    expect(findMatches(d, 'de', false)).toEqual([])
    expect(findMatches(d, '', false)).toEqual([])
  })
})

describe('document schema', () => {
  it('accepts everything the v1 importer can produce', () => {
    const imported = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [text('Titel')] },
        { type: 'paragraph', attrs: { indent: 40 }, content: [{ type: 'text', text: 'x', marks: [{ type: 'bold' }, { type: 'italic' }, { type: 'underline' }, { type: 'strike' }] }] },
        { type: 'blockquote', content: [{ type: 'paragraph', content: [text('Zitat')] }] },
        { type: 'orderedList', content: [{ type: 'listItem', content: [{ type: 'paragraph' }] }] },
        { type: 'pageBreak' },
        { type: 'paragraph' }
      ]
    }
    expect(() => schema.nodeFromJSON(imported).check()).not.toThrow()
  })
})
