const Characters = {
  _char: null,
  _project: null,
  _saveTimer: null,

  ROLES: [
    { value: 'protagonist', label: 'Protagonist', color: '#c9a96e' },
    { value: 'antagonist',  label: 'Antagonist',  color: '#e07070' },
    { value: 'supporting',  label: 'Supporting',  color: '#4caf82' },
    { value: 'minor',       label: 'Minor',       color: '#5a5855' },
  ],

  DETAIL_FIELDS: [
    { key: 'age',        label: 'Age',       placeholder: '–' },
    { key: 'pronouns',   label: 'Pronouns',  placeholder: 'she/her' },
    { key: 'occupation', label: 'Occupation',placeholder: '–' },
    { key: 'origin',     label: 'Origin',    placeholder: '–' },
    { key: 'height',     label: 'Height',    placeholder: '–' },
    { key: 'build',      label: 'Build',     placeholder: '–' },
    { key: 'hair',       label: 'Hair',      placeholder: '–' },
    { key: 'eyes',       label: 'Eyes',      placeholder: '–' },
  ],

  roleColor(role) {
    return (this.ROLES.find(r => r.value === role) || this.ROLES[3]).color
  },

  roleLabel(role) {
    return (this.ROLES.find(r => r.value === role) || this.ROLES[3]).label
  },

  async mount(container, project, charId) {
    this._project = project
    this._char = null

    if (!charId) { this._renderEmpty(container); return }

    const chars = await Project.readCharacters(project.dir)
    const char = chars.find(c => c.id === charId)
    if (!char) { this._renderEmpty(container); return }

    this._char = char
    this._render(container, char, project)
  },

  _renderEmpty(container) {
    container.innerHTML = `<div class="char-empty">Select a character from the sidebar</div>`
  },

  _render(container, char, project) {
    const imgSrc = char.imageFile
      ? `file://${project.dir}/characters/images/${char.imageFile}`
      : null

    const refImages = char.refImages || []

    container.innerHTML = `
      <div class="char-panel char-enter">
        <div class="char-scroll">

          <div class="char-header">
            <div class="char-portrait-wrap">
              ${this._portraitHTML(imgSrc, char)}
            </div>
            <div class="char-header-info">
              <input class="char-name-input" id="char-name"
                value="${this._esc(char.name || '')}"
                placeholder="Character name…" autocomplete="off" spellcheck="false"/>
              <div class="char-role-row">
                ${this.ROLES.map(r => `
                  <button class="char-role-btn ${char.role === r.value ? 'active' : ''}"
                    data-role="${r.value}" style="--role-color:${r.color}">${r.label}</button>
                `).join('')}
              </div>
            </div>
          </div>

          <div class="char-fields">

            <div class="char-details-grid">
              ${this.DETAIL_FIELDS.map(f => `
                <div class="char-detail-cell">
                  <label class="char-label">${f.label.toUpperCase()}</label>
                  <input class="char-detail-input" data-key="${f.key}"
                    value="${this._esc(char[f.key] || '')}"
                    placeholder="${f.placeholder}" autocomplete="off"/>
                </div>
              `).join('')}
              <div class="char-detail-cell char-detail-full">
                <label class="char-label">TRAITS</label>
                <input class="char-detail-input" data-key="traits"
                  value="${this._esc(char.traits || '')}"
                  placeholder="Determined, perceptive, stubborn…" autocomplete="off"/>
              </div>
            </div>

            <label class="char-label" style="margin-top:24px">DESCRIPTION</label>
            <textarea class="char-textarea" id="char-description" rows="5"
              placeholder="Physical appearance, background, personality…">${this._esc(char.description || '')}</textarea>

            <label class="char-label" style="margin-top:20px">NOTES</label>
            <textarea class="char-textarea" id="char-notes" rows="5"
              placeholder="Story role, arc, relationships…">${this._esc(char.notes || '')}</textarea>

            <div class="char-refs-section">
              <div class="char-refs-header">
                <span class="char-label">REFERENCE IMAGES</span>
                <button class="char-refs-add" id="char-refs-add" title="Add reference image">+ Add</button>
              </div>
              <div class="char-refs-grid" id="char-refs-grid">
                ${refImages.map((f, i) => this._refThumbHTML(f, i, project)).join('')}
                ${refImages.length === 0 ? `<span class="char-refs-empty">No reference images yet</span>` : ''}
              </div>
            </div>

          </div>
        </div>
      </div>
    `

    this._bindEvents(container, char, project)
  },

  _portraitHTML(imgSrc, char) {
    const cam = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>`
    return `
      <div class="char-portrait" id="char-portrait" title="Click to change portrait">
        ${imgSrc
          ? `<img src="${imgSrc}" class="char-portrait-img" draggable="false"/>`
          : `<div class="char-portrait-placeholder"><span>${(char.name || '?')[0].toUpperCase()}</span></div>`
        }
        <div class="char-portrait-overlay">${cam}</div>
      </div>
      ${imgSrc ? `<button class="char-portrait-remove" id="char-portrait-remove" title="Remove portrait">✕</button>` : ''}
    `
  },

  _refThumbHTML(filename, index, project) {
    const src = `file://${project.dir}/characters/images/${filename}`
    return `
      <div class="char-ref-thumb" data-index="${index}">
        <img src="${src}" draggable="false"/>
        <button class="char-ref-remove" data-index="${index}" title="Remove">✕</button>
      </div>
    `
  },

  _bindEvents(container, char, project) {
    const schedSave = () => {
      clearTimeout(this._saveTimer)
      this._saveTimer = setTimeout(() => this._save(project), 800)
    }

    // Name
    const nameInput = container.querySelector('#char-name')
    nameInput?.addEventListener('input', () => {
      char.name = nameInput.value
      const sidebarLbl = document.querySelector(`.char-sidebar-row[data-id="${char.id}"] .char-sidebar-name`)
      if (sidebarLbl) sidebarLbl.textContent = char.name || 'Unnamed'
      const placeholder = container.querySelector('.char-portrait-placeholder span')
      if (placeholder) placeholder.textContent = (char.name || '?')[0].toUpperCase()
      schedSave()
    })

    // Role pills
    container.querySelectorAll('.char-role-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        char.role = btn.dataset.role
        container.querySelectorAll('.char-role-btn').forEach(b => b.classList.toggle('active', b.dataset.role === char.role))
        const dot = document.querySelector(`.char-sidebar-row[data-id="${char.id}"] .char-sidebar-dot`)
        if (dot) dot.style.background = this.roleColor(char.role)
        schedSave()
      })
    })

    // Detail fields
    container.querySelectorAll('.char-detail-input').forEach(inp => {
      inp.addEventListener('input', () => {
        char[inp.dataset.key] = inp.value
        schedSave()
      })
    })

    // Description / Notes
    container.querySelector('#char-description')?.addEventListener('input', e => { char.description = e.target.value; schedSave() })
    container.querySelector('#char-notes')?.addEventListener('input', e => { char.notes = e.target.value; schedSave() })

    // Portrait
    container.querySelector('#char-portrait')?.addEventListener('click', () => this._pickPortrait(container, char, project))
    container.querySelector('#char-portrait-remove')?.addEventListener('click', e => {
      e.stopPropagation()
      this._removePortrait(container, char, project)
    })

    // Reference images
    container.querySelector('#char-refs-add')?.addEventListener('click', () => this._addRefImage(container, char, project))

    container.querySelector('#char-refs-grid')?.addEventListener('click', e => {
      const removeBtn = e.target.closest('.char-ref-remove')
      if (removeBtn) {
        e.stopPropagation()
        this._removeRefImage(container, char, project, parseInt(removeBtn.dataset.index))
      }
    })
  },

  async _pickPortrait(container, char, project) {
    const fp = await api.dialog.file([{ name: 'Images', extensions: ['jpg','jpeg','png','webp','gif'] }])
    if (!fp) return
    const ext = fp.split('.').pop().toLowerCase()
    const destFile = `${char.id}.${ext}`
    await api.fs.mkdir(`${project.dir}/characters/images`)
    await api.fs.copy(fp, `${project.dir}/characters/images/${destFile}`)
    char.imageFile = destFile
    await this._save(project)
    const wrap = container.querySelector('.char-portrait-wrap')
    if (wrap) {
      wrap.innerHTML = this._portraitHTML(`file://${project.dir}/characters/images/${destFile}?t=${Date.now()}`, char)
      wrap.querySelector('#char-portrait').addEventListener('click', () => this._pickPortrait(container, char, project))
      wrap.querySelector('#char-portrait-remove')?.addEventListener('click', e => { e.stopPropagation(); this._removePortrait(container, char, project) })
    }
  },

  async _removePortrait(container, char, project) {
    if (char.imageFile) {
      try { await api.fs.delete(`${project.dir}/characters/images/${char.imageFile}`) } catch {}
      char.imageFile = null
      await this._save(project)
    }
    const wrap = container.querySelector('.char-portrait-wrap')
    if (wrap) {
      wrap.innerHTML = this._portraitHTML(null, char)
      wrap.querySelector('#char-portrait').addEventListener('click', () => this._pickPortrait(container, char, project))
    }
  },

  async _addRefImage(container, char, project) {
    const fp = await api.dialog.file([{ name: 'Images', extensions: ['jpg','jpeg','png','webp','gif'] }])
    if (!fp) return
    const ext = fp.split('.').pop().toLowerCase()
    const ts = Date.now()
    const destFile = `${char.id}-ref-${ts}.${ext}`
    await api.fs.mkdir(`${project.dir}/characters/images`)
    await api.fs.copy(fp, `${project.dir}/characters/images/${destFile}`)
    if (!char.refImages) char.refImages = []
    char.refImages.push(destFile)
    await this._save(project)
    this._refreshRefGrid(container, char, project)
  },

  async _removeRefImage(container, char, project, index) {
    const file = (char.refImages || [])[index]
    if (!file) return
    try { await api.fs.delete(`${project.dir}/characters/images/${file}`) } catch {}
    char.refImages.splice(index, 1)
    await this._save(project)
    this._refreshRefGrid(container, char, project)
  },

  _refreshRefGrid(container, char, project) {
    const grid = container.querySelector('#char-refs-grid')
    if (!grid) return
    const refs = char.refImages || []
    if (refs.length === 0) {
      grid.innerHTML = `<span class="char-refs-empty">No reference images yet</span>`
    } else {
      grid.innerHTML = refs.map((f, i) => this._refThumbHTML(f, i, project)).join('')
    }
  },

  async _save(project) {
    if (!this._char) return
    await Project.saveCharacter(project.dir, this._char)
    await this._saveMarkdown(project, this._char)
  },

  async _saveMarkdown(project, char) {
    const role = this.roleLabel(char.role)
    const detailLines = this.DETAIL_FIELDS
      .filter(f => char[f.key])
      .map(f => `**${f.label}:** ${char[f.key]}`)
    if (char.traits) detailLines.push(`**Traits:** ${char.traits}`)

    const lines = [
      `# ${char.name || 'Unnamed'}`,
      '',
      `**Role:** ${role}`,
    ]

    if (detailLines.length) {
      lines.push('')
      lines.push('## Details')
      lines.push('')
      lines.push(detailLines.join('  \n'))
    }

    if (char.description) {
      lines.push('')
      lines.push('## Description')
      lines.push('')
      lines.push(char.description)
    }

    if (char.notes) {
      lines.push('')
      lines.push('## Notes')
      lines.push('')
      lines.push(char.notes)
    }

    if ((char.refImages || []).length) {
      lines.push('')
      lines.push('## Reference Images')
      lines.push('')
      char.refImages.forEach(f => lines.push(`![Reference](images/${f})`))
    }

    await api.fs.write(`${project.dir}/characters/${char.id}.md`, lines.join('\n'))
  },

  _esc(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  },
}
