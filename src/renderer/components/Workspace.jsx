import React from 'react'
import { useStore } from '../store'
import Titlebar from './Titlebar'
import Sidebar from './Sidebar/Sidebar'
import Editor from './Editor/Editor'
import Board from './Canvas/Board'
import Settings from './Settings/Settings'

export default function Workspace({ project }) {
  const { view, sidebar } = useStore()
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <Titlebar project={project} />
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {sidebar && view !== 'settings' && <Sidebar project={project} />}
        <main style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          {view === 'editor'   && <Editor   project={project} />}
          {view === 'board'    && <Board    project={project} />}
          {view === 'settings' && <Settings project={project} />}
        </main>
      </div>
    </div>
  )
}
