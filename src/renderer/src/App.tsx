import { useEffect } from 'react'
import { StartScreen } from './StartScreen'
import { useApp } from './store'
import { Workspace } from './Workspace'

export function App() {
  const ready = useApp((s) => s.ready)
  const project = useApp((s) => s.project)
  const error = useApp((s) => s.error)
  const showError = useApp((s) => s.showError)

  useEffect(() => {
    void useApp.getState().init()
    const onKey = (e: KeyboardEvent): void => {
      if (e.metaKey && e.key.toLowerCase() === 'o') {
        e.preventDefault()
        void useApp.getState().openProject()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (!ready) return null
  return (
    <>
      {project ? <Workspace /> : <StartScreen />}
      {error && (
        <div className="toast" role="alert" data-testid="error" onClick={() => showError(null)}>
          {error}
        </div>
      )}
    </>
  )
}
