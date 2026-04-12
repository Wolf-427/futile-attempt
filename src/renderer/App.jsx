import React, { useEffect, useState } from 'react';
import { useStore } from './store';
import WelcomeScreen from './components/Shell/WelcomeScreen';
import Workspace from './components/Shell/Workspace';

export default function App() {
  const { activeProjectId, projects } = useStore();
  const [ready, setReady] = useState(false);
  useEffect(() => { const t = setTimeout(() => setReady(true), 80); return () => clearTimeout(t); }, []);
  if (!ready) return <div style={{ width:'100%', height:'100%', background:'#0f0f0d' }} />;
  const activeProject = projects.find((p) => p.id === activeProjectId);
  return activeProject ? <Workspace project={activeProject} /> : <WelcomeScreen />;
}
