export class EditorCore {
  constructor(element, options = {}) {
    this.container = element;
    this.initialLang = options.lang || 'en-US';
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
        attributes: { class: 'ProseMirror scriptum-editor-v2', spellcheck: 'true', lang: this.initialLang }
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
  
  async setLanguage(lang) {
    if (!this.instance || this.instance.isDestroyed) return;
    
    // Get current attributes and ensure we include the new language
    const attrs = { 
      ...this.instance.options.editorProps.attributes,
      lang: lang 
    };

    // Sync the DOM attribute immediately to help Chromium detect the change
    this.container.querySelector('.ProseMirror')?.setAttribute('lang', lang);
    
    // 1. Update language and temporarily disable spellcheck to force a reset
    this.instance.setOptions({
      editorProps: { attributes: { ...attrs, lang: lang, spellcheck: 'false' } }
    });

    // 2. Wait for the engine to acknowledge the session-wide change and dictionary load
    await new Promise(r => setTimeout(r, 600));
    if (this.instance.isDestroyed) return;

    // 3. Re-enable spellcheck to trigger the re-scan with the new dictionary
    this.instance.setOptions({
      editorProps: { attributes: { ...attrs, lang: lang, spellcheck: 'true' } }
    });
  }

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
