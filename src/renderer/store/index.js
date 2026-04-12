import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { v4 as uuid } from 'uuid';

export const useStore = create(
  persist(
    (set, get) => ({
      projects: [], activeProjectId: null,
      addProject: (p) => set((s) => ({ projects: [...s.projects, p], activeProjectId: p.id })),
      updateProject: (id, patch) => set((s) => ({ projects: s.projects.map((p) => p.id === id ? { ...p, ...patch } : p) })),
      removeProject: (id) => set((s) => ({ projects: s.projects.filter((p) => p.id !== id), activeProjectId: s.activeProjectId === id ? null : s.activeProjectId })),
      setActiveProject: (id) => set({ activeProjectId: id, activeDocPath: null }),
      get activeProject() { const s = get(); return s.projects.find((p) => p.id === s.activeProjectId) || null; },
      activeDocPath: null,
      setActiveDoc: (p) => set({ activeDocPath: p, activeView: 'editor' }),
      activeView: 'editor',
      setActiveView: (v) => set({ activeView: v }),
      activeBoardPath: 'master.json',
      boardHistory: [],
      setActiveBoard: (bp, push = true) => set((s) => ({ activeBoardPath: bp, activeView: 'board', boardHistory: push ? [...s.boardHistory, s.activeBoardPath] : s.boardHistory })),
      boardBack: () => set((s) => { if (!s.boardHistory.length) return {}; const prev = s.boardHistory[s.boardHistory.length - 1]; return { activeBoardPath: prev, boardHistory: s.boardHistory.slice(0, -1) }; }),
      gitStatus: { initialized: false, dirty: false, lastCommit: null, branch: 'main', syncing: false, error: null },
      setGitStatus: (patch) => set((s) => ({ gitStatus: { ...s.gitStatus, ...patch } })),
      sidebarCollapsed: false,
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
    }),
    { name: 'scriptum-state', partialize: (s) => ({ projects: s.projects, activeProjectId: s.activeProjectId, activeDocPath: s.activeDocPath, activeBoardPath: s.activeBoardPath, sidebarCollapsed: s.sidebarCollapsed }) }
  )
);
