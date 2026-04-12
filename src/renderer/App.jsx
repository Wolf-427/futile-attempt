import React, { useState, useEffect } from 'react'
import { useStore } from './store'
import Welcome from './components/Welcome'
import Workspace from './components/Workspace'

export default function App() {
  const { activeId, projects } = useStore()
  const [ready, setReady] = useState(false)

  useEffect(() => { setTimeout(() => setReady(true), 50) }, [])
  if (!ready) return <div style={{ height: '100%', background: '#0f0f0d' }} />

  const project = projects.find(p => p.id === activeId)
  return project ? <Workspace project={project} /> : <Welcome />
}
