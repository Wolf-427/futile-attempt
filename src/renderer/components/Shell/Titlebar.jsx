import React, { useEffect, useCallback } from 'react';
import { useStore } from '../../store';
import { getStatus, stageAndCommit, pushToGitHub, addRemote } from '../../services/git';
import s from './Titlebar.module.css';

export default function Titlebar({ project }) {
  const { activeView, setActiveView, gitStatus, setGitStatus, toggleSidebar } = useStore();

  const refresh = useCallback(async () => {
    if (!project?.folderPath) return;
    setGitStatus(await getStatus(project.folderPath));
  }, [project?.folderPath]);

  useEffect(() => { refresh(); const i = setInterval(refresh, 15000); return () => clearInterval(i); }, [refresh]);

  async function handleCommit() {
    if (!gitStatus.dirty || gitStatus.syncing) return;
    setGitStatus({ syncing: true, error: null });
    try { await stageAndCommit(project.folderPath, `Save ${new Date().toLocaleString()}`); await refresh(); }
    catch (e) { setGitStatus({ error: e.message }); }
    setGitStatus({ syncing: false });
  }

  async function handlePush() {
    if (gitStatus.syncing) return;
    setGitStatus({ syncing: true, error: null });
    try {
      const token = await window.api.keychain.getToken();
      if (!token) throw new Error('No GitHub token — add one in Settings');
      // Set remote URL from store if available
      const remoteUrl = await window.api.store.get('github-remote-url');
      if (remoteUrl) await addRemote(project.folderPath, remoteUrl);
      await pushToGitHub(project.folderPath, 'origin', token);
      await refresh();
    } catch (e) { setGitStatus({ error: e.message }); }
    setGitStatus({ syncing: false });
  }

  return (
    <header className={s.root}>
      <div className={s.lights} />
      <button className={s.iconBtn} onClick={toggleSidebar} title="Toggle sidebar">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="1" y="3" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="1.2"/><line x1="5" y1="3" x2="5" y2="13" stroke="currentColor" strokeWidth="1.2"/></svg>
      </button>
      <span className={s.name}>{project.name}</span>
      <div className={s.switch}>
        <button className={`${s.switchBtn} ${activeView==='editor'   ? s.active : ''}`} onClick={() => setActiveView('editor')}>Editor</button>
        <button className={`${s.switchBtn} ${activeView==='board'    ? s.active : ''}`} onClick={() => setActiveView('board')}>Canvas</button>
        <button className={`${s.switchBtn} ${activeView==='settings' ? s.active : ''}`} onClick={() => setActiveView('settings')}>Settings</button>
      </div>
      <div className={s.spacer} />
      <div className={s.git}>
        {gitStatus.error && <span className={s.gitErr} title={gitStatus.error}>⚠ {gitStatus.error.slice(0,40)}</span>}
        {gitStatus.initialized && <>
          <span className={s.branch}>⎇ {gitStatus.branch}</span>
          <span className={`${s.dot} ${gitStatus.dirty ? s.dirty : s.clean}`} title={gitStatus.dirty ? 'Unsaved changes' : 'All committed'} />
          <button className={s.gitBtn} onClick={handleCommit} disabled={!gitStatus.dirty||gitStatus.syncing}>{gitStatus.syncing ? 'Saving…' : 'Commit'}</button>
          <button className={s.gitBtn} onClick={handlePush} disabled={gitStatus.syncing}>Push ↑</button>
        </>}
      </div>
    </header>
  );
}
