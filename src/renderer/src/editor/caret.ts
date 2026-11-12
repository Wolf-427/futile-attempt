import { Extension } from '@tiptap/core'
import { Plugin, PluginKey, Selection } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'

/**
 * The text position for a click that did not land on text: in a margin, in
 * the blank rest of a page, or in the gap between two pages. It is the line
 * at that height, or the nearest line above it.
 */
function nearestTextPosition(view: EditorView, x: number, y: number): number {
  const rect = view.dom.getBoundingClientRect()
  const style = getComputedStyle(view.dom)
  const left = Math.min(
    Math.max(x, rect.left + parseFloat(style.paddingLeft) + 2),
    rect.right - parseFloat(style.paddingRight) - 2
  )
  for (let top = y; top > rect.top && top > y - 1600; top -= 8) {
    const el = document.elementFromPoint(left, top)
    if (!el || el === view.dom || !view.dom.contains(el) || el.closest('[data-rm-pagination]')) continue
    const hit = view.posAtCoords({ left, top })
    if (hit) return hit.pos
  }
  return view.state.doc.content.size
}

/**
 * Keeps the caret inside the text. Without this, a click on an empty part of
 * a page leaves the browser's caret outside any paragraph, and the next
 * keystroke starts a stray one.
 */
export const Caret = Extension.create({
  name: 'caret',

  addKeyboardShortcuts() {
    return {
      'Mod-End': () => this.editor.commands.focus('end'),
      'Mod-Home': () => this.editor.commands.focus('start')
    }
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('caret'),
        props: {
          handleDOMEvents: {
            mousedown: (view, event) => {
              const target = event.target
              if (event.button !== 0 || !(target instanceof Element)) return false
              const outsideText = target === view.dom || target.closest('[data-rm-pagination]') !== null
              if (!outsideText) return false
              event.preventDefault()
              const pos = nearestTextPosition(view, event.clientX, event.clientY)
              const selection = Selection.near(view.state.doc.resolve(pos), -1)
              view.dispatch(view.state.tr.setSelection(selection))
              view.focus()
              return true
            }
          }
        }
      })
    ]
  }
})
