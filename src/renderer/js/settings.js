const Settings = {
  async mount(container, project) {
    const version = await api.app.version().catch(() => '0.1.0')
    const token   = await api.store.get('gh-token').catch(() => null)
    const appRepo = await api.store.get('app-repo').catch(() => '')

    container.innerHTML = `
      <div class="settings">
        <h2>Settings</h2>

        <div class="settings-section">
          <div class="settings-title">Current version</div>
          <div class="settings-version">v${version}</div>
        </div>

        <div class="settings-section">
          <div class="settings-title">GitHub token</div>
          <div class="settings-note">Personal access token with <strong>repo</strong> scope.<br>GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic) → New token → tick repo</div>
          <div id="token-area">
            ${token
              ? `<div class="settings-row"><span style="color:var(--ok);font-size:13px">✓ Token saved</span><button class="btn-sm danger" id="clear-token" style="margin-left:10px">Remove</button></div>`
              : `<div class="settings-row"><input type="password" class="settings-input" id="token-input" placeholder="ghp_…"/><button class="btn-sm" id="save-token" style="margin-left:8px">Save</button></div>`
            }
          </div>
        </div>

        <div class="settings-section">
          <div class="settings-title">App source repo</div>
          <div class="settings-note">The GitHub repo where Scriptum's code lives — used to check for updates. Format: owner/repo</div>
          <div class="settings-row">
            <input class="settings-input" id="app-repo" placeholder="Wolf-427/futile-attempt" value="${appRepo}"/>
            <button class="btn-sm" id="save-app-repo" style="margin-left:8px">Save</button>
          </div>
          <div id="repo-msg" class="settings-msg" style="margin-top:6px"></div>
        </div>

        <div class="settings-section">
          <div class="settings-title">App updates</div>
          <div class="settings-note">Scriptum checks GitHub for new commits and downloads changed files directly — no build needed.</div>
          <div id="update-card"></div>
          <button class="btn-sm" id="check-update" style="margin-top:8px">Check for updates</button>
          <div id="update-msg" class="settings-msg" style="margin-top:8px"></div>
        </div>
      </div>
    `
    this._bind()
  },

  _bind() {
    document.getElementById('save-token')?.addEventListener('click', async () => {
      const t = document.getElementById('token-input')?.value?.trim(); if (!t) return
      await api.store.set('gh-token', t)
      document.getElementById('token-area').innerHTML = `<div class="settings-row"><span style="color:var(--ok);font-size:13px">✓ Token saved</span><button class="btn-sm danger" id="clear-token" style="margin-left:10px">Remove</button></div>`
      document.getElementById('clear-token').addEventListener('click', async () => { await api.store.del('gh-token'); location.reload() })
    })
    document.getElementById('clear-token')?.addEventListener('click', async () => { await api.store.del('gh-token'); location.reload() })

    document.getElementById('save-app-repo').addEventListener('click', async () => {
      await api.store.set('app-repo', document.getElementById('app-repo').value.trim())
      const m = document.getElementById('repo-msg'); m.textContent = 'Saved'; m.className = 'settings-msg ok'
      setTimeout(() => m.textContent = '', 2000)
    })

    document.getElementById('check-update').addEventListener('click', async () => {
      const repo = document.getElementById('app-repo').value.trim() || await api.store.get('app-repo')
      if (!repo) { this._msg('Enter app source repo first', 'err'); return }
      const [owner, repoName] = repo.split('/')
      if (!owner || !repoName) { this._msg('Format must be owner/repo', 'err'); return }
      const token = await api.store.get('gh-token')
      this._msg('Checking…', ''); document.getElementById('update-card').innerHTML = ''
      const result = await api.updater.check(token, owner, repoName)
      if (result.error) { this._msg('Error: ' + result.error, 'err'); return }
      if (!result.hasUpdate) { this._msg('✓ Already up to date', 'ok'); return }
      this._msg('', '')
      document.getElementById('update-card').innerHTML = `
        <div class="update-card">
          <div class="update-title">Update available</div>
          ${result.message ? `<div class="update-msg">${result.message}</div>` : ''}
          <button class="btn-sm primary" id="apply-btn" style="margin-top:12px">Download and apply</button>
        </div>
      `
      document.getElementById('apply-btn').addEventListener('click', async () => {
        document.getElementById('apply-btn').disabled = true
        this._msg('Applying update…', '')
        const r = await api.updater.apply(token, owner, repoName, result.latestSha)
        if (r.ok) { this._msg(`✓ Updated ${r.filesUpdated} files. Restarting…`, 'ok'); setTimeout(() => api.updater.restart(), 1500) }
        else { this._msg('✗ ' + r.error, 'err'); document.getElementById('apply-btn').disabled = false }
      })
    })
  },

  _msg(text, type) {
    const m = document.getElementById('update-msg')
    if (m) { m.textContent = text; m.className = 'settings-msg' + (type ? ' ' + type : '') }
  }
}
