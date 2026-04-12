import React from 'react';
import { useStore } from '../../store';
import Titlebar from './Titlebar';
import Sidebar from '../Sidebar/Sidebar';
import EditorView from '../Editor/EditorView';
import BoardView from '../Canvas/BoardView';
import UpdateChecker from '../Settings/UpdateChecker';

export default function Workspace({ project }) {
  const { activeView, sidebarCollapsed } = useStore();
  const showSidebar = !sidebarCollapsed && activeView !== 'settings';
  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', overflow:'hidden', background:'var(--bg-base)' }}>
      <Titlebar project={project} />
      <div style={{ display:'flex', flex:1, overflow:'hidden' }}>
        {showSidebar && <Sidebar project={project} />}
        <main style={{ flex:1, overflow:'hidden', display:'flex', flexDirection:'column' }}>
          {activeView === 'editor'   && <EditorView    project={project} />}
          {activeView === 'board'    && <BoardView     project={project} />}
          {activeView === 'settings' && <UpdateChecker />}
        </main>
      </div>
    </div>
  );
}
