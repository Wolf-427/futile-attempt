import { LayoutEngine } from './LayoutEngine.js';

export class Paginator {
  constructor(editorCore) {
    this.editor = editorCore;
    this.config = {
      pageHeight: 1123,
      margin: 96,
      pageGap: 32, // Match Editor.PAGE_GAP to prevent background/text drift
      contentHeight: 931 
    };
    this.engine = new LayoutEngine(this.config);
  }

  updateConfig(params) {
    this.config = { ...this.config, ...params };
    this.config.contentHeight = this.config.pageHeight - (this.config.margin * 2);
    this.engine.updateConfig(this.config);
  }

  refresh() {
    if (!this.editor.instance || this.editor.instance.isDestroyed) return;

    const { Decoration, DecorationSet } = window.Tiptap;
    const doc = this.editor.instance.state.doc;
    const view = this.editor.instance.view;

    // 1. Clear existing decorations and force a synchronous DOM update.
    // We MUST ensure the old spacers are removed from the DOM before measuring,
    // otherwise the LayoutEngine safety check will bail and return 1 page.
    this.editor.setDecorations(DecorationSet.empty);
    if (view.updateState) view.updateState(view.state);

    void view.dom.offsetHeight; 
    
    // 2. Measure coordinates while the document is "flat".
    // Note: ProseMirror usually handles the DOM reflow synchronously on state change,
    // allowing engine.compute to read the updated "flat" coordinates immediately.
    const { breaks, pageCount } = this.engine.compute(view);

    const decorations = [];
    breaks.forEach(b => {
      const widget = Decoration.widget(b.pos, () => {
        const spacer = document.createElement('div');
        spacer.className = 'page-auto-spacer';
        spacer.style.height = `${b.height}px`;
        return spacer;
      }, { side: -1, block: true });
      decorations.push(widget);
    });

    this.editor.setDecorations(DecorationSet.create(doc, decorations));
    this._updateUI(pageCount);
  }

  _updateUI(pageCount) {
    const wrap = document.getElementById('editor-page-wrap');
    if (!wrap) return;

    // Update the "Desk" rendering
    let desk = document.getElementById('editor-desk');
    if (!desk) {
      desk = document.createElement('div');
      desk.id = 'editor-desk';
      wrap.prepend(desk);
    }

    // Completely clear and rebuild the desk tiles
    desk.innerHTML = '';
    for (let i = 0; i < pageCount; i++) {
      const page = document.createElement('div');
      page.className = 'page-tile';
      page.style.height = this.config.pageHeight + 'px';
      page.style.marginBottom = this.config.pageGap + 'px';
      page.setAttribute('data-page-number', i + 1);
      desk.appendChild(page);
    }
     // Ensure the container expands to fit the desk so scrolling works correctly
    const totalDeskHeight = (pageCount * this.config.pageHeight) + ((pageCount - 1) * this.config.pageGap);
    wrap.style.minHeight = totalDeskHeight + 'px';

    
  }
}