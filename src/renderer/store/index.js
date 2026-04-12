import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export const useStore = create(
  persist(
    (set, get) => ({
      projects: [],
      activeId: null,
      addProject: (p) => set(s => ({ projects: [...s.projects, p], activeId: p.id })),
      removeProject: (id) => set(s => ({ projects: s.projects.filter(p => p.id !== id), activeId: s.activeId === id ? null : s.activeId })),
      setActive: (id) => set({ activeId: id, docPath: null, view: 'editor' }),
      get project() { return get().projects.find(p => p.id === get().activeId) || null },

      view: 'editor',
      setView: (v) => set({ view: v }),

      docPath: null,
      setDoc: (p) => set({ docPath: p, view: 'editor' }),

      boardFile: 'master.json',
      boardStack: [],
      openBoard: (file, push = true) => set(s => ({
        boardFile: file,
        view: 'board',
        boardStack: push ? [...s.boardStack, s.boardFile] : s.boardStack,
      })),
      boardBack: () => set(s => {
        if (!s.boardStack.length) return {}
        const prev = s.boardStack[s.boardStack.length - 1]
        return { boardFile: prev, boardStack: s.boardStack.slice(0, -1) }
      }),

      sidebar: true,
      toggleSidebar: () => set(s => ({ sidebar: !s.sidebar })),

      git: { dirty: false, branch: 'main', syncing: false, error: null },
      setGit: (p) => set(s => ({ git: { ...s.git, ...p } })),
    }),
    {
      name: 'scriptum-store',
      partialize: s => ({
        projects: s.projects,
        activeId: s.activeId,
        docPath: s.docPath,
        boardFile: s.boardFile,
        sidebar: s.sidebar,
      }),
    }
  )
)
