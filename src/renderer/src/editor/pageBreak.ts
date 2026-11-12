import { Node, mergeAttributes } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    pageBreak: {
      /** End the current page here; what follows starts on the next page. */
      insertPageBreak: () => ReturnType
    }
  }
}

/**
 * Stretch every manual page break so it fills the rest of its page.
 *
 * Page boundaries are floats whose positions do not depend on the text, so
 * the height a break needs is simply the distance to the next boundary below
 * it. Breaks are handled top to bottom because each one moves the ones after.
 */
export function layoutPageBreaks(root: HTMLElement): void {
  const breaks = root.querySelectorAll<HTMLElement>('.page-break')
  if (breaks.length === 0) return
  const boundaries = Array.from(root.querySelectorAll<HTMLElement>('[data-rm-pagination] .breaker'))
  if (boundaries.length === 0) return
  const rootTop = root.getBoundingClientRect().top
  const tops = boundaries.map((b) => b.getBoundingClientRect().top - rootTop)

  for (const el of breaks) {
    const top = el.getBoundingClientRect().top - rootTop
    const next = tops.find((t) => t >= top - 0.5)
    const height = next === undefined ? 0 : Math.max(0, Math.floor(next - top))
    const value = `${height}px`
    if (el.style.height !== value) el.style.height = value
  }
}

export const PageBreak = Node.create({
  name: 'pageBreak',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  parseHTML() {
    return [{ tag: 'div[data-type="pageBreak"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'pageBreak', class: 'page-break' })]
  },

  addCommands() {
    return {
      insertPageBreak:
        () =>
        ({ chain }) =>
          chain()
            .insertContent([{ type: this.name }, { type: 'paragraph' }])
            .scrollIntoView()
            .run()
    }
  },

  addKeyboardShortcuts() {
    return { 'Mod-Enter': () => this.editor.commands.insertPageBreak() }
  },

  addProseMirrorPlugins() {
    let frame = 0
    const schedule = (root: HTMLElement): void => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => layoutPageBreaks(root))
    }
    return [
      new Plugin({
        key: new PluginKey('pageBreakLayout'),
        view: (view) => {
          schedule(view.dom)
          // Font loading and window resizing change line heights without a transaction.
          const observer = new ResizeObserver(() => schedule(view.dom))
          observer.observe(view.dom)
          return {
            update: (v, prev) => {
              if (!v.state.doc.eq(prev.doc)) schedule(v.dom)
            },
            destroy: () => {
              cancelAnimationFrame(frame)
              observer.disconnect()
            }
          }
        }
      })
    ]
  }
})
