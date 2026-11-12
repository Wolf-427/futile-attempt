import { Extension } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

export interface Match {
  from: number
  to: number
}

export interface SearchState {
  query: string
  caseSensitive: boolean
  matches: Match[]
  /** Index into `matches` of the highlighted one, or -1. */
  current: number
  decorations: DecorationSet
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    search: {
      setSearch: (query: string, caseSensitive?: boolean) => ReturnType
      clearSearch: () => ReturnType
      findNext: () => ReturnType
      findPrevious: () => ReturnType
      replaceCurrent: (replacement: string) => ReturnType
      replaceAll: (replacement: string) => ReturnType
    }
  }
}

export const searchKey = new PluginKey<SearchState>('search')

/**
 * Find every occurrence of `query`. Each text block is searched as one string,
 * so a word is found even when part of it is bold. Inline leaves such as line
 * breaks occupy one position, like a character, so offsets map directly.
 */
export function findMatches(doc: PMNode, query: string, caseSensitive: boolean): Match[] {
  if (!query) return []
  const needle = caseSensitive ? query : query.toLocaleLowerCase()
  const matches: Match[] = []
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true
    let text = ''
    node.forEach((child) => {
      text += child.isText ? (child.text ?? '') : '￼'.repeat(child.nodeSize)
    })
    const haystack = caseSensitive ? text : text.toLocaleLowerCase()
    // Lower-casing can change a string's length in a few scripts; skip mapping then.
    if (haystack.length !== text.length) return false
    for (let i = haystack.indexOf(needle); i !== -1; i = haystack.indexOf(needle, i + needle.length)) {
      matches.push({ from: pos + 1 + i, to: pos + 1 + i + needle.length })
    }
    return false
  })
  return matches
}

function decorate(doc: PMNode, matches: Match[], current: number): DecorationSet {
  return DecorationSet.create(
    doc,
    matches.map((m, i) =>
      Decoration.inline(m.from, m.to, { class: i === current ? 'search-match current' : 'search-match' })
    )
  )
}

const EMPTY: SearchState = { query: '', caseSensitive: false, matches: [], current: -1, decorations: DecorationSet.empty }

type Meta = { query: string; caseSensitive: boolean } | { current: number }

export const Search = Extension.create({
  name: 'search',

  addProseMirrorPlugins() {
    return [
      new Plugin<SearchState>({
        key: searchKey,
        state: {
          init: () => EMPTY,
          apply(tr, prev) {
            const meta = tr.getMeta(searchKey) as Meta | undefined
            if (meta && 'query' in meta) {
              if (!meta.query) return EMPTY
              const matches = findMatches(tr.doc, meta.query, meta.caseSensitive)
              // Start at the first match at or after the cursor.
              const at = tr.selection.from
              const first = matches.findIndex((m) => m.to >= at)
              const current = matches.length ? (first === -1 ? 0 : first) : -1
              return { ...meta, matches, current, decorations: decorate(tr.doc, matches, current) }
            }
            if (meta && 'current' in meta) {
              return { ...prev, current: meta.current, decorations: decorate(tr.doc, prev.matches, meta.current) }
            }
            if (tr.docChanged && prev.query) {
              const matches = findMatches(tr.doc, prev.query, prev.caseSensitive)
              const current = matches.length ? Math.min(Math.max(prev.current, 0), matches.length - 1) : -1
              return { ...prev, matches, current, decorations: decorate(tr.doc, matches, current) }
            }
            return prev
          }
        },
        props: {
          decorations: (state) => searchKey.getState(state)?.decorations ?? DecorationSet.empty
        }
      })
    ]
  },

  addCommands() {
    const step =
      (delta: number) =>
      () =>
      ({ state, dispatch, view }: { state: import('@tiptap/pm/state').EditorState; dispatch?: ((tr: import('@tiptap/pm/state').Transaction) => void) | undefined; view: import('@tiptap/pm/view').EditorView }) => {
        const search = searchKey.getState(state)
        if (!search || search.matches.length === 0) return false
        const current = (search.current + delta + search.matches.length) % search.matches.length
        const match = search.matches[current]
        if (!match) return false
        if (dispatch) {
          dispatch(state.tr.setMeta(searchKey, { current }))
          // Scroll the match into view without stealing focus from the find field.
          requestAnimationFrame(() => {
            const dom = view.domAtPos(match.from).node
            const el = dom instanceof Element ? dom : dom.parentElement
            el?.scrollIntoView({ block: 'center' })
          })
        }
        return true
      }

    return {
      setSearch:
        (query, caseSensitive = false) =>
        ({ tr, dispatch }) => {
          if (dispatch) dispatch(tr.setMeta(searchKey, { query, caseSensitive }).setMeta('addToHistory', false))
          return true
        },
      clearSearch:
        () =>
        ({ tr, dispatch }) => {
          if (dispatch) dispatch(tr.setMeta(searchKey, { query: '', caseSensitive: false }).setMeta('addToHistory', false))
          return true
        },
      findNext: step(1),
      findPrevious: step(-1),
      replaceCurrent:
        (replacement) =>
        ({ state, dispatch }) => {
          const search = searchKey.getState(state)
          const match = search?.matches[search.current]
          if (!match) return false
          if (dispatch) {
            const tr = replacement
              ? state.tr.insertText(replacement, match.from, match.to)
              : state.tr.delete(match.from, match.to)
            dispatch(tr.setSelection(TextSelection.create(tr.doc, match.from + replacement.length)))
          }
          return true
        },
      replaceAll:
        (replacement) =>
        ({ state, dispatch }) => {
          const search = searchKey.getState(state)
          if (!search || search.matches.length === 0) return false
          if (dispatch) {
            const tr = state.tr
            // Back to front, so earlier positions stay valid. One undo step.
            for (const match of [...search.matches].reverse()) {
              if (replacement) tr.insertText(replacement, match.from, match.to)
              else tr.delete(match.from, match.to)
            }
            dispatch(tr)
          }
          return true
        }
    }
  }
})
