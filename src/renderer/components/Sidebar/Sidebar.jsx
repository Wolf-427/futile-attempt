import React, { useEffect, useState, useCallback } from 'react';
import { useStore } from '../../store';
import { readDocTree, readBoards, createBoard } from '../../services/project';
import s from './Sidebar.module.css';

export default function Sidebar({ project }) {
  const { activeDocPath, setActiveDoc, activeView, setActiveBoard, activeBoardPath } = useStore();
  const [docTree, setDocTree] = useState([]);
  const [boards, setBoards] = useState([]);
  const [creatingDoc, setCreatingDoc] = useState(false);
  const [newName, setNewName] = useState('');

  const refresh = useCallback(async () => {
    if (!project?.folderPath) return;
    setDocTree(await readDocTree(project.folderPath));
    setBoards(await readBoards(project.folderPath));
  }, [project?.folderPath]);

  useEffect(() => { refresh(); }, [refresh]);

  async function handleNewDoc() {
    if (!newName.trim()) return;
    await window.api.fs.writeFile(`${project.folderPath}/documents/${newName.trim()}.md`, `# ${newName.trim()}\n\n`);
    setCreatingDoc(false); setNewName(''); await refresh();
    setActiveDoc(`${project.folderPath}/documents/${newName.trim()}.md`);
  }

  async function handleNewBoard() {
    const b = await createBoard(project.folderPath, `Board ${boards.length + 1}`);
    await refresh(); setActiveBoard(b.fileName);
  }

  return (
    <aside className={s.root}>
      <div className={s.section}>
        <div className={s.header}><span className={s.label}>Documents</span><button className={s.add} onClick={() => setCreatingDoc(true)}>+</button></div>
        {creatingDoc && <input autoFocus className={s.newInput} placeholder="Name…" value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => { if (e.key==='Enter') handleNewDoc(); if (e.key==='Escape') { setCreatingDoc(false); setNewName(''); } }}
          onBlur={() => { if (!newName.trim()) setCreatingDoc(false); }} />}
        <div className={s.tree}>
          {docTree.map((n) => <TreeNode key={n.path} node={n} activeDocPath={activeDocPath} onSelect={setActiveDoc} />)}
          {!docTree.length && !creatingDoc && <span className={s.empty}>No documents yet</span>}
        </div>
      </div>
      <div className={s.section}>
        <div className={s.header}><span className={s.label}>Canvas boards</span><button className={s.add} onClick={handleNewBoard}>+</button></div>
        <button className={`${s.boardItem} ${activeView==='board'&&activeBoardPath==='master.json' ? s.boardActive : ''}`} onClick={() => setActiveBoard('master.json', false)}>
          ◎ Master board
        </button>
        {boards.filter((b) => !b.isMaster).map((b) => (
          <button key={b.fileName} className={`${s.boardItem} ${activeView==='board'&&activeBoardPath===b.fileName ? s.boardActive : ''}`} onClick={() => setActiveBoard(b.fileName, false)}>
            ⊞ <span className={s.truncate}>{b.name}</span>
            <span className={s.count}>{(b.nodes||[]).length}</span>
          </button>
        ))}
      </div>
      <div className={s.footer}>
        <button className={s.footerBtn} onClick={() => window.api.shell.openPath(project.folderPath)} title={project.folderPath}>
          ⌂ {project.folderPath.split('/').pop()}
        </button>
      </div>
    </aside>
  );
}

function TreeNode({ node, activeDocPath, onSelect }) {
  const [expanded, setExpanded] = useState(true);
  const s2 = { display:'flex', alignItems:'center', gap:6, padding:'5px 6px', border:'none', background:'transparent', borderRadius:'var(--radius-sm)', cursor:'pointer', width:'100%', textAlign:'left', fontFamily:'var(--font-sans)', fontSize:'12.5px', color:'var(--text-secondary)' };
  if (node.type === 'folder') return (
    <div>
      <button style={s2} onClick={() => setExpanded((e) => !e)}>{expanded ? '▾' : '▸'} 📁 {node.name}</button>
      {expanded && <div style={{ paddingLeft:14 }}>{node.children.map((c) => <TreeNode key={c.path} node={c} activeDocPath={activeDocPath} onSelect={onSelect} />)}</div>}
    </div>
  );
  const active = activeDocPath === node.path;
  return <button style={{ ...s2, background: active ? 'var(--bg-active)' : 'transparent', color: active ? 'var(--text-primary)' : 'var(--text-secondary)' }} onClick={() => onSelect(node.path)}>📄 {node.name}</button>;
}
