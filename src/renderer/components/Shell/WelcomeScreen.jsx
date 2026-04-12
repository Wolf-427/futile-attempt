import React, { useState } from 'react';
import { useStore } from '../../store';
import { createProject, openProject } from '../../services/project';
import s from './WelcomeScreen.module.css';

export default function WelcomeScreen() {
  const { addProject, projects, setActiveProject } = useStore();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleCreate() {
    if (!name.trim()) return;
    setLoading(true); setError('');
    try {
      const folderPath = await window.api.dialog.openFolder();
      if (!folderPath) { setLoading(false); return; }
      const { projectPath, manifest } = await createProject({ name: name.trim(), folderPath });
      addProject({ id:manifest.id, name:manifest.name, folderPath:projectPath, createdAt:manifest.createdAt, updatedAt:manifest.createdAt });
    } catch(e) { setError(e.message); }
    setLoading(false);
  }

  async function handleOpen() {
    setLoading(true); setError('');
    try {
      const folderPath = await window.api.dialog.openFolder();
      if (!folderPath) { setLoading(false); return; }
      const manifest = await openProject(folderPath);
      const existing = projects.find((p) => p.folderPath === folderPath);
      if (existing) { setActiveProject(existing.id); }
      else { addProject({ id:manifest.id, name:manifest.name, folderPath, createdAt:manifest.createdAt, updatedAt:Date.now() }); }
    } catch(e) { setError(e.message); }
    setLoading(false);
  }

  return (
    <div className={s.root}>
      <div className={s.drag} />
      <div className={s.center}>
        <div className={s.wordmark}>Scriptum</div>
        <p className={s.tagline}>A place for writing that thinks</p>
        {!creating ? (
          <div className={s.actions}>
            <button className={s.primary} onClick={() => setCreating(true)}>New project</button>
            <button className={s.secondary} onClick={handleOpen} disabled={loading}>Open project</button>
          </div>
        ) : (
          <div className={s.form}>
            <input className={s.input} placeholder="Project name…" value={name} autoFocus
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key==='Enter') handleCreate(); if (e.key==='Escape') { setCreating(false); setName(''); } }} />
            <div className={s.formRow}>
              <button className={s.secondary} onClick={() => { setCreating(false); setName(''); setError(''); }} disabled={loading}>Cancel</button>
              <button className={s.primary} onClick={handleCreate} disabled={loading||!name.trim()}>{loading ? 'Creating…' : 'Choose folder →'}</button>
            </div>
          </div>
        )}
        {error && <p className={s.error}>{error}</p>}
        {projects.length > 0 && (
          <div className={s.recent}>
            <p className={s.recentLabel}>Recent</p>
            {[...projects].reverse().slice(0,5).map((p) => (
              <button key={p.id} className={s.recentItem} onClick={() => setActiveProject(p.id)}>
                <span className={s.recentName}>{p.name}</span>
                <span className={s.recentPath}>{p.folderPath}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
