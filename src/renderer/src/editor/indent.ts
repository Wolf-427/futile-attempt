import { Extension } from '@tiptap/core'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    indent: {
      indent: () => ReturnType
      outdent: () => ReturnType
    }
  }
}

const STEP = 40
const MAX = 240

/** Left indentation for paragraphs, in steps. Tab and Shift-Tab outside lists. */
export const Indent = Extension.create({
  name: 'indent',

  addGlobalAttributes() {
    return [
      {
        types: ['paragraph'],
        attributes: {
          indent: {
            default: null,
            parseHTML: (el) => {
              const px = parseFloat(el.style.paddingLeft)
              return Number.isFinite(px) && px > 0 ? px : null
            },
            renderHTML: (attrs) =>
              typeof attrs['indent'] === 'number' && attrs['indent'] > 0
                ? { style: `padding-left: ${attrs['indent']}px` }
                : {}
          }
        }
      }
    ]
  },

  addCommands() {
    const shift =
      (delta: number) =>
      () =>
      ({ state, dispatch }: { state: import('@tiptap/pm/state').EditorState; dispatch?: ((tr: import('@tiptap/pm/state').Transaction) => void) | undefined }) => {
        const { from, to } = state.selection
        const tr = state.tr
        let changed = false
        state.doc.nodesBetween(from, to, (node, pos) => {
          if (node.type.name !== 'paragraph') return true
          const current = typeof node.attrs['indent'] === 'number' ? node.attrs['indent'] : 0
          const next = Math.max(0, Math.min(MAX, current + delta))
          if (next !== current) {
            tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent: next || null })
            changed = true
          }
          return false
        })
        if (changed && dispatch) dispatch(tr)
        return changed
      }
    return { indent: shift(STEP), outdent: shift(-STEP) }
  },

  addKeyboardShortcuts() {
    return {
      // Lists handle Tab themselves; this only applies when they decline.
      Tab: () => (this.editor.isActive('listItem') ? false : this.editor.commands.indent() || true),
      'Shift-Tab': () => (this.editor.isActive('listItem') ? false : this.editor.commands.outdent() || true)
    }
  }
})
