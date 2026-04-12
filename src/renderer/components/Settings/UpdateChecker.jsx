import React, { useState, useEffect } from 'react';
import { checkForUpdates, setUpdateRepo, getUpdateRepo, markCurrentSha } from '../../services/updater';
import s from './UpdateChecker.module.css';

export default function UpdateChecker() {
  const [repo, setRepo] = useState('');
  const [repoInput, setRepoInput] = useState('');
  const [token, setToken] = useState('');
  const [tokenSaved, setTokenSaved] = useState(false);
  const [status, setStatus] = useState(null); // null | 'checking' | 'up-to-date' | 'update-available' | 'error'
  const [updateInfo, setUpdateInfo] = useState(null);
  const [error, setError] = useState('');
  const [remoteUrl, setRemoteUrl] = useState('');
  const [remoteUrlInput, setRemoteUrlInput] = useState('');
  const [remoteSaved, setRemoteSaved] = useState(false);

  useEffect(() => {
    (async () => {
      const r = await getUpdateRepo();
      if (r) { setRepo(r); setRepoInput(r); }
      const t = await window.api.keychain.getToken();
      if (t) { setToken('••••••••••••••••'); setTokenSaved(true); }
      const ru = await window.api.store.get('github-remote-url');
      if (ru) { setRemoteUrl(ru); setRemoteUrlInput(ru); }
    })();
  }, []);

  async function saveRepo() {
    const v = repoInput.trim();
    if (!v.includes('/')) { setError('Format must be owner/repo'); return; }
    await setUpdateRepo(v);
    setRepo(v);
    setError('');
  }

  async function saveToken() {
    const t = token.startsWith('•') ? null : token.trim();
    if (!t) return;
    await window.api.keychain.setToken(t);
    setToken('••••••••••••••••');
    setTokenSaved(true);
  }

  async function clearToken() {
    await window.api.keychain.deleteToken();
    setToken('');
    setTokenSaved(false);
  }

  async function saveRemoteUrl() {
    const v = remoteUrlInput.trim();
    await window.api.store.set('github-remote-url', v);
    setRemoteUrl(v);
    setRemoteSaved(true);
    setTimeout(() => setRemoteSaved(false), 2000);
  }

  async function handleCheck() {
    setStatus('checking');
    setError('');
    setUpdateInfo(null);
    try {
      const info = await checkForUpdates();
      setUpdateInfo(info);
      setStatus(info.hasUpdate ? 'update-available' : 'up-to-date');
    } catch (e) {
      setError(e.message);
      setStatus('error');
    }
  }

  function handleInstallInstructions() {
    const instructions = `To update Scriptum:\n\n1. Open Terminal\n2. Run these commands:\n\n   cd ~/Developer/scriptum\n   git pull origin main\n   npm install\n   npm run dev\n\nOr if you built the app:\n   npm run build`;
    alert(instructions);
  }

  return (
    <div className={s.root}>
      <h2 className={s.title}>Settings</h2>

      {/* GitHub Token */}
      <section className={s.section}>
        <h3 className={s.sectionTitle}>GitHub token</h3>
        <p className={s.desc}>Personal access token with <code>repo</code> scope. Used for pushing commits and checking for updates.</p>
        <div className={s.row}>
          <input
            className={s.input}
            type="password"
            placeholder={tokenSaved ? 'Token saved — enter new to replace' : 'ghp_xxxxxxxxxxxx'}
            value={tokenSaved ? '' : token}
            onChange={(e) => { setToken(e.target.value); setTokenSaved(false); }}
          />
          <button className={s.btn} onClick={saveToken} disabled={!token || tokenSaved}>Save</button>
          {tokenSaved && <button className={s.btnDanger} onClick={clearToken}>Clear</button>}
        </div>
        {tokenSaved && <p className={s.saved}>✓ Token saved</p>}
      </section>

      {/* Source repo (for updates) */}
      <section className={s.section}>
        <h3 className={s.sectionTitle}>App source repository</h3>
        <p className={s.desc}>The GitHub repo where the Scriptum source code lives. Used to check for app updates. Format: <code>owner/repo</code></p>
        <div className={s.row}>
          <input
            className={s.input}
            placeholder="e.g. yourname/scriptum"
            value={repoInput}
            onChange={(e) => setRepoInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && saveRepo()}
          />
          <button className={s.btn} onClick={saveRepo}>Save</button>
        </div>
        {repo && <p className={s.saved}>✓ Watching {repo}</p>}
      </section>

      {/* Project remote URL */}
      <section className={s.section}>
        <h3 className={s.sectionTitle}>Project remote URL</h3>
        <p className={s.desc}>The GitHub URL for your writing project repo (for Push ↑ in the titlebar).</p>
        <div className={s.row}>
          <input
            className={s.input}
            placeholder="https://github.com/yourname/my-novel.git"
            value={remoteUrlInput}
            onChange={(e) => setRemoteUrlInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && saveRemoteUrl()}
          />
          <button className={s.btn} onClick={saveRemoteUrl}>Save</button>
        </div>
        {remoteSaved && <p className={s.saved}>✓ Saved</p>}
        {remoteUrl && !remoteSaved && <p className={s.saved}>✓ {remoteUrl}</p>}
      </section>

      {/* Update checker */}
      <section className={s.section}>
        <h3 className={s.sectionTitle}>App updates</h3>
        <p className={s.desc}>Check if a newer version of Scriptum is available on GitHub.</p>

        <div className={s.row}>
          <button className={s.btn} onClick={handleCheck} disabled={status === 'checking' || !repo}>
            {status === 'checking' ? 'Checking…' : 'Check for updates'}
          </button>
        </div>

        {status === 'up-to-date' && (
          <div className={s.upToDate}>✓ You're up to date</div>
        )}

        {status === 'update-available' && updateInfo && (
          <div className={s.updateAvail}>
            <p className={s.updateTitle}>Update available</p>
            <p className={s.updateMsg}>{updateInfo.latestMessage}</p>
            <p className={s.updateMeta}>{new Date(updateInfo.latestDate).toLocaleDateString()} · {updateInfo.latestSha?.slice(0,7)}</p>
            <button className={s.btnPrimary} onClick={handleInstallInstructions}>
              How to install →
            </button>
          </div>
        )}

        {status === 'error' && <p className={s.errorMsg}>{error}</p>}
      </section>
    </div>
  );
}
