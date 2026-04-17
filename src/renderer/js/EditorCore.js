import { createSpellcheckExtension } from './SpellcheckPlugin.js'

export class EditorCore {
  constructor(element, options = {}) {
    this.container = element;
    this.initialLang = options.lang || 'en-US';
    this.onUpdate = options.onUpdate || (() => {});
    this.onSelectionUpdate = options.onSelectionUpdate || (() => {});
    this.spellcheckApi = options.spellcheckApi || null;
    this._spellcheckExt = null;
    this.instance = null;
    this._init();
  }

  _init() {
    const { Editor, StarterKit, Placeholder, Underline, TextAlign, Extension, Plugin, DecorationSet, Mark } = window.Tiptap;

    const FontSizeMark = Mark.create({
      name: 'fontSize',
      addAttributes: () => ({
        size: {
          default: null,
          parseHTML: el => el.style.fontSize ? el.style.fontSize.replace('px', '') : null,
          renderHTML: attrs => attrs.size ? { style: `font-size: ${attrs.size}px` } : {}
        }
      }),
      parseHTML: () => [{ tag: 'span', getAttrs: el => el.style?.fontSize ? {} : false }],
      renderHTML: ({ HTMLAttributes }) => ['span', HTMLAttributes, 0],
      addCommands: () => ({
        setFontSize: size => ({ commands }) => commands.setMark('fontSize', { size: String(size) }),
      })
    });

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

    const extensions = [
      StarterKit,
      Placeholder.configure({ placeholder: 'Start writing...' }),
      Underline,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      this.paginationExtension,
      FontSizeMark,
    ];

    if (this.spellcheckApi) {
      this._spellcheckExt = createSpellcheckExtension(this.spellcheckApi);
      extensions.push(this._spellcheckExt);
    }

    this.instance = new Editor({
      element: this.container,
      extensions,
      editorProps: {
        // spellcheck disabled — handled entirely by the nspell plugin
        attributes: { class: 'ProseMirror scriptum-editor-v2', spellcheck: 'false', lang: this.initialLang }
      },
      onUpdate: ({ transaction }) => {
        if (transaction.getMeta('isPagination') || !transaction.docChanged) return;
        this.onUpdate(this.instance);
      },
      onSelectionUpdate: ({ editor }) => this.onSelectionUpdate(editor)
    });
  }

  setContent(content) { this.instance.commands.setContent(content, false); }
  getHTML() { return this.instance.getHTML(); }

  setFontSize(size) {
    if (!this.instance || this.instance.isDestroyed) return
    this.instance.chain().focus().setFontSize(size).run()
  }

  getActiveFontSize() {
    if (!this.instance || this.instance.isDestroyed) return null
    return this.instance.getAttributes('fontSize').size || null
  }

  async setLanguage(lang) {
    if (!this.instance || this.instance.isDestroyed) return;

    // Update the lang attribute so CSS / AT tooling sees the right language
    const el = this.container.querySelector('.ProseMirror');
    if (el) el.setAttribute('lang', lang);

    // Keep Tiptap's internal options in sync
    const attrs = { ...this.instance.options.editorProps.attributes, lang };
    this.instance.setOptions({ editorProps: { attributes: attrs } });

    // Tell nspell to load the new dictionary, then immediately re-check
    if (this.spellcheckApi) {
      await this.spellcheckApi.setLanguage(lang).catch(() => {});
      this._spellcheckExt?.forceRecheck?.();
    }
  }

  setDecorations(decorations) {
    if (!this.instance || this.instance.isDestroyed) return;
    const transaction = this.instance.state.tr;
    this.instance.storage.pagination.decos = decorations;
    transaction.setMeta('isPagination', true);
    transaction.setMeta('addToHistory', false);
    this.instance.view.dispatch(transaction);
  }
}
