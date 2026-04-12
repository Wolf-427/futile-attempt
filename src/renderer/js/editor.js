const Editor = {
  _docPath: null,
  _saveTimer: null,
  _content: null,

  mount(container) {
    container.innerHTML = `
      <div class="editor">
        <div class="editor-toolbar" id="editor-toolbar"></div>
        <div class="editor-scroll">
          <div class="editor-page">
            <div id="editor-content" class="ProseMirror" contenteditable="true" spellcheck="true" data-placeholder="Begin writing…"></div>
          </div>
        </div>
        <div class="editor-status">
          <span id="word-count">0 words</span>
          <span id="char-count">0 characters</span>
        </div>
      </div>
    `
    this._content = document.getElementById('editor-content')
    this._buildToolbar()
    this._content.addEventListener('input', () => this._onInput())
    this._content.addEventListener('keydown', e => this._onKeydown(e))
  },

  _buildToolbar() {
    const tb = document.getElementById('editor-toolbar')
    const btn = (label, cmd, arg, title) => {
      const b = document.createElement('button')
      b.className = 'editor-tool'
      b.textContent = label
      b.title = title || label
      b.dataset.cmd = cmd
      b.dataset.arg = arg || ''
      b.addEventListener('mousedown', e => { e.preventDefault(); this._exec(cmd, arg); this._updateToolbar() })
      return b
    }
    const div = () => { const d = document.createElement('div'); d.className = 'editor-div'; return d }
    ;[
      btn('H1', 'formatBlock', 'h1'), btn('H2', 'formatBlock', 'h2'), btn('H3', 'formatBlock', 'h3'), div(),
      btn('B', 'bold', '', 'Bold ⌘B'), btn('I', 'italic', '', 'Italic ⌘I'), btn('U', 'underline', '', 'Underline ⌘U'), div(),
      btn('❝', 'formatBlock', 'blockquote'), btn('•', 'insertUnorderedList'), btn('1.', 'insertOrderedList'), div(),
    ].forEach(el => tb.appendChild(el))
    this._content.addEventListener('keyup', () => this._updateToolbar())
    this._content.addEventListener('mouseup', () => this._updateToolbar())
  },

  _exec(cmd, arg) { document.execCommand(cmd, false, arg || null); this._content.focus() },

  _updateToolbar() {
    document.querySelectorAll('.editor-tool[data-cmd]').forEach(btn => {
      const cmd = btn.dataset.cmd, arg = btn.dataset.arg
      let active = false
      try {
        if (cmd === 'formatBlock') active = document.queryCommandValue('formatBlock').toLowerCase() === arg
        else active = document.queryCommandState(cmd)
      } catch {}
      btn.classList.toggle('active', active)
    })
  },

  _onInput() {
    this._updateCounts()
    clearTimeout(this._saveTimer)
    this._saveTimer = setTimeout(() => this._save(), 1400)
    Store.patch('git', { dirty: true })
  },

  _onKeydown(e) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'b') { e.preventDefault(); this._exec('bold') }
    if ((e.metaKey || e.ctrlKey) && e.key === 'i') { e.preventDefault(); this._exec('italic') }
    if ((e.metaKey || e.ctrlKey) && e.key === 'u') { e.preventDefault(); this._exec('underline') }
  },

  _updateCounts() {
    const text = this._content.innerText || ''
    const words = text.trim() ? text.trim().split(/\s+/).length : 0
    const wc = document.getElementById('word-count')
    const cc = document.getElementById('char-count')
    if (wc) wc.textContent = `${words} words`
    if (cc) cc.textContent = `${text.length} characters`
  },

  async loadDoc(path) {
    this._docPath = path
    try {
      const md = await api.fs.read(path)
      this._content.innerHTML = this._md2html(md)
    } catch { this._content.innerHTML = '<p><br></p>' }
    this._updateCounts()
    this._updateToolbar()
  },

  async _save() {
    if (!this._docPath) return
    try { await api.fs.write(this._docPath, this._html2md(this._content.innerHTML)) } catch {}
  },

  _md2html(md) {
    return md
      .replace(/^### (.+)$/gm, '<h3>$1</h3>')
      .replace(/^## (.+)$/gm, '<h2>$1</h2>')
      .replace(/^# (.+)$/gm, '<h1>$1</h1>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
      .split('\n\n').map(b => b.startsWith('<') ? b : `<p>${b || '<br>'}</p>`).join('')
      || '<p><br></p>'
  },

  _html2md(html) {
    return html
      .replace(/<h1[^>]*>(.*?)<\/h1>/gi, '# $1\n')
      .replace(/<h2[^>]*>(.*?)<\/h2>/gi, '## $1\n')
      .replace(/<h3[^>]*>(.*?)<\/h3>/gi, '### $1\n')
      .replace(/<strong[^>]*>(.*?)<\/strong>/gi, '**$1**')
      .replace(/<em[^>]*>(.*?)<\/em>/gi, '*$1*')
      .replace(/<blockquote[^>]*>(.*?)<\/blockquote>/gi, '> $1\n')
      .replace(/<li[^>]*>(.*?)<\/li>/gi, '- $1\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
      .trim() + '\n'
  }
}
