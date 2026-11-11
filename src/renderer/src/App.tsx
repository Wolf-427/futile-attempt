import { useEffect, useState } from 'react'
import type { AppInfo } from '@shared/ipc'

export function App() {
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    window.scriptum.app
      .getInfo()
      .then(setInfo)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
  }, [])

  return (
    <main className="shell">
      <h1 data-testid="app-title">Scriptum</h1>
      {info && (
        <p data-testid="app-version">
          v{info.version} · Electron {info.electron} · {info.platform}
        </p>
      )}
      {error && (
        <p data-testid="app-error" role="alert">
          {error}
        </p>
      )}
    </main>
  )
}
