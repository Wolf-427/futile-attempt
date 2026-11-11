# Scriptum v2

Rewrite of Scriptum. The v1 code is preserved at the `v1-final` tag.

## Commands

| Command | Does |
| --- | --- |
| `npm install` | Install dependencies |
| `npm run dev` | Start the app with hot reload |
| `npm run typecheck` | Type-check main, preload and renderer |
| `npm test` | Unit tests (Vitest) |
| `npm run test:e2e` | Build, then run the end-to-end test (Playwright) |
| `npm run check` | All of the above checks in sequence |
| `npm run dist` | Build the macOS DMG |

## Layout

```
src/shared/     IPC contract shared by all processes
src/main/       Main process: windows, IPC handlers, later the storage service
src/preload/    Bridge exposing the typed API as window.scriptum
src/renderer/   React UI
tests/unit/     Vitest
tests/e2e/      Playwright driving the built Electron app
```

## Rules

- The renderer is sandboxed and has no file-system access.
- Every main-process capability is one entry in `src/shared/ipc.ts`.
