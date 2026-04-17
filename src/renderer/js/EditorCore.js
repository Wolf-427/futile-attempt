export class EditorCore {
  constructor(element, options = {}) {
    this.container = element;
    this.onUpdate = options.onUpdate || (() => {});
    this.onSelectionUpdate = options.onSelectionUpdate || (() => {});
    this.instance = null;
    this._init();
  }

  _init() {
    const { Editor, StarterKit, Placeholder, Underline, TextAlign, Extension, Plugin, DecorationSet } = window.Tiptap;

    this.paginationExtension = Extension.create({
      name: 'pagination',
      addStorage: () => ({ decos: window.Tiptap.DecorationSet.empty }),
      addProseMirrorPlugins() {
        return [new Plugin({
          key: new window.Tiptap.PluginKey('pagination'),
          props: { decorations: (state) => this.storage.decos }
        })];
      }
    });

    this.instance = new Editor({
      element: this.container,
      extensions: [
        StarterKit,
        Placeholder.configure({ placeholder: 'Start writing...' }),
        Underline,
        TextAlign.configure({ types: ['heading', 'paragraph'] }),
        this.paginationExtension,
      ],
      editorProps: {
        attributes: { class: 'ProseMirror scriptum-editor-v2', spellcheck: 'true' }
      },
      onUpdate: ({ transaction }) => {
        // STOP the loop: Ignore transactions we sent ourselves
        if (transaction.getMeta('isPagination') || !transaction.docChanged) return;
        this.onUpdate(this.instance);
      },
      onSelectionUpdate: ({ editor }) => this.onSelectionUpdate(editor)
    });
  }

  setContent(content) { this.instance.commands.setContent(content, false); }
  getHTML() { return this.instance.getHTML(); }
  
  setDecorations(decorations) {
    if (!this.instance || this.instance.isDestroyed) return;
    
    // Atomic storage update
    const transaction = this.instance.state.tr;
    this.instance.storage.pagination.decos = decorations;
    
    // Metadata 'isPagination' prevents the onUpdate loop
    transaction.setMeta('isPagination', true);
    transaction.setMeta('addToHistory', false);
    this.instance.view.dispatch(transaction);
  }
}
