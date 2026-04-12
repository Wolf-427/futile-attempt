import React, { useState, useEffect } from 'react'
import styles from './Settings.module.css'

export default function Settings() {
  const [version, setVersion]     = useState('')
  const [token, setToken]         = useState('')
  const [tokenSaved, setTokenSaved] = useState(false)
  const [appRepo, setAppRepo]     = useState('')
  const [repoMsg, setRepoMsg]     = useState('')
  const [updateStatus, setUpdateStatus] = useState(null)
  const [updateInfo, setUpdateInfo]     = useState(null)

  useEffect(() => {
    window.api.app.version().then(v => setVersion(v || '0.1.0')).catch(() => setVersion('0.1.0'))
    window.api.store.get('gh-token').then(t => { if (t) setTokenSaved(true) })
    window.api.store.get('app-repo').then(v => { if (v) setAppRepo(v) })
  }, [])

  async function saveToken() {
    const t = token.trim()
    if (!t) return
    await window.api.store.set('gh-token', t)
    setTokenSaved(true)
    setToken('')
  }

  async function clearToken() {
    await window.api.store.del('gh-token')
    setTokenSaved(false)
  }

  async function saveRepo() {
    await window.api.store.set('app-repo', appRepo.trim())
    setRepoMsg('Saved')
    setTimeout(() => setRepoMsg(''), 2000)
  }

  async function checkUpdates() {
    const repo = appRepo.trim() || await window.api.store.get('app-repo')
    if (!repo) { setUpdateStatus('error'); setUpdateInfo({ msg: 'Enter app source repo first' }); return }
    const [owner, repoName] = repo.split('/')
    if (!owner || !repoName) { setUpdateStatus('error'); setUpdateInfo({ msg: 'Format must be owner/repo' }); return }
    const t = await window.api.store.get('gh-token')
    setUpdateStatus('checking')
    setUpdateInfo(null)
    const result = await window.api.updater.check(t, owner, repoName)
    if (result.error) { setUpdateStatus('error'); setUpdateInfo({ msg: result.error }); return }
    if (!result.hasUpdate) { setUpdateStatus('current'); return }
    setUpdateStatus('available')
    setUpdateInfo(result)
  }

  async function applyUpdate() {
    const repo = appRepo.trim() || await window.api.store.get('app-repo')
    const [owner, repoName] = repo.split('/')
    const t = await window.api.store.get('gh-token')
    setUpdateStatus('applying')
    const r = await window.api.updater.apply(t, owner, repoName, updateInfo.latestSha)
    if (r.ok) {
      setUpdateStatus('done')
      setUpdateInfo({ filesUpdated: r.filesUpdated })
      setTimeout(() => window.api.updater.restart(), 1500)
    } else {
      setUpdateStatus('error')
      setUpdateInfo({ msg: r.error })
    }
  }

  return (
    <div className={styles.root}>
      <h2 className={styles.title}>Settings</h2>

      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Current version</h3>
        <p className={styles.version}>v{version}</p>
      </section>

      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>GitHub token</h3>
        <p className={styles.note}>
          Personal access token with <strong>repo</strong> scope — used to check for app updates.<br />
          GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic) → New token → tick repo
        </p>
        {tokenSaved ? (
          <div className={styles.row}>
            <span className={styles.ok}>✓ Token saved</span>
            <button className={`${styles.btn} ${styles.danger}`} onClick={clearToken}>Remove</button>
          </div>
        ) : (
          <div className={styles.row}>
            <input type="password" className={styles.input} placeholder="ghp_…" value={token} onChange={e => setToken(e.target.value)} onKeyDown={e => e.key === 'Enter' && saveToken()} />
            <button className={styles.btn} onClick={saveToken} disabled={!token.trim()}>Save</button>
          </div>
        )}
      </section>

      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>App source repo</h3>
        <p className={styles.note}>The GitHub repo where Scriptum's code lives. Format: owner/repo</p>
        <div className={styles.row}>
          <input className={styles.input} placeholder="Wolf-427/futile-attempt" value={appRepo} onChange={e => setAppRepo(e.target.value)} onKeyDown={e => e.key === 'Enter' && saveRepo()} />
          <button className={styles.btn} onClick={saveRepo}>Save</button>
        </div>
        {repoMsg && <p className={styles.ok} style={{ marginTop: 6 }}>{repoMsg}</p>}
      </section>

      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>App updates</h3>
        <p className={styles.note}>Scriptum downloads changed files directly from GitHub and restarts — no build needed.</p>

        {updateStatus === 'checking' && <p className={styles.muted}>⟳ Checking…</p>}
        {updateStatus === 'current'  && <p className={styles.ok}>✓ Already up to date</p>}
        {updateStatus === 'applying' && <p className={styles.muted}>Applying update…</p>}
        {updateStatus === 'done'     && <p className={styles.ok}>✓ Updated {updateInfo?.filesUpdated} files. Restarting…</p>}
        {updateStatus === 'error'    && <p className={styles.errMsg}>{updateInfo?.msg}</p>}

        {updateStatus === 'available' && updateInfo && (
          <div className={styles.updateCard}>
            <p className={styles.updateTitle}>Update available</p>
            {updateInfo.message && <p className={styles.updateMsg}>{updateInfo.message}</p>}
            <button className={`${styles.btn} ${styles.primary}`} onClick={applyUpdate} style={{ marginTop: 12 }}>
              Download and apply
            </button>
          </div>
        )}

        {(!updateStatus || updateStatus === 'current' || updateStatus === 'error') && (
          <button className={styles.btn} onClick={checkUpdates} disabled={!tokenSaved} style={{ marginTop: updateStatus ? 12 : 0 }}>
            Check for updates
          </button>
        )}

        {!tokenSaved && <p className={styles.muted} style={{ marginTop: 8 }}>Save a GitHub token above first.</p>}
      </section>
    </div>
  )
}
