import type { Editor } from '@tiptap/core'
import { useEditorState } from '@tiptap/react'
import { useEffect, useRef, useState } from 'react'
import { searchKey } from './search'

export function FindBar({ editor, onClose }: { editor: Editor; onClose(): void }) {
  const [query, setQuery] = useState(() => {
    const { from, to } = editor.state.selection
    const selected = editor.state.doc.textBetween(from, to, ' ')
    return selected.length > 0 && selected.length < 80 ? selected : ''
  })
  const [replacement, setReplacement] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  const found = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      const state = searchKey.getState(e.state)
      return { total: state?.matches.length ?? 0, current: state?.current ?? -1 }
    }
  })

  useEffect(() => {
    input.current?.focus()
    input.current?.select()
  }, [])

  useEffect(() => {
    editor.commands.setSearch(query, caseSensitive)
  }, [editor, query, caseSensitive])

  return (
    <div
      className="findbar"
      data-testid="findbar"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose()
      }}
    >
      <input
        ref={input}
        className="field find-field"
        data-testid="find-input"
        placeholder="Find"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            if (e.shiftKey) editor.commands.findPrevious()
            else editor.commands.findNext()
          }
        }}
      />
      <span className="find-count" data-testid="find-count">
        {query ? (found.total ? `${found.current + 1} of ${found.total}` : 'No results') : ''}
      </span>
      <button className="tool" title="Previous (⇧↵)" onClick={() => editor.commands.findPrevious()}>
        ↑
      </button>
      <button className="tool" title="Next (↵)" onClick={() => editor.commands.findNext()}>
        ↓
      </button>
      <button className={caseSensitive ? 'tool active' : 'tool'} title="Match case" onClick={() => setCaseSensitive((v) => !v)}>
        Aa
      </button>
      <input
        className="field find-field"
        data-testid="replace-input"
        placeholder="Replace with"
        value={replacement}
        onChange={(e) => setReplacement(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') editor.commands.replaceCurrent(replacement)
        }}
      />
      <button className="tool" data-testid="replace-one" disabled={!found.total} onClick={() => editor.commands.replaceCurrent(replacement)}>
        Replace
      </button>
      <button className="tool" data-testid="replace-all" disabled={!found.total} onClick={() => editor.commands.replaceAll(replacement)}>
        All
      </button>
      <button className="tool" title="Close (Esc)" onClick={onClose}>
        ×
      </button>
    </div>
  )
}
