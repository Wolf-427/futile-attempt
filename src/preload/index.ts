import { contextBridge, ipcRenderer } from 'electron'
import type { IpcArgs, IpcChannel, IpcEvents, IpcResult, ScriptumApi } from '@shared/ipc'

function invoke<C extends IpcChannel>(channel: C, ...args: IpcArgs<C>): Promise<IpcResult<C>> {
  return ipcRenderer.invoke(channel, ...args) as Promise<IpcResult<C>>
}

function subscribe<E extends keyof IpcEvents>(event: E, listener: (payload: IpcEvents[E]) => void): () => void {
  const handler = (_: unknown, payload: IpcEvents[E]): void => listener(payload)
  ipcRenderer.on(event, handler)
  return () => {
    ipcRenderer.removeListener(event, handler)
  }
}

const api: ScriptumApi = {
  app: {
    getInfo: () => invoke('app:getInfo'),
    onHandOver: (listener) => subscribe('app:handOver', () => listener()),
    handedOver: () => invoke('app:handedOver')
  },
  projects: {
    recent: () => invoke('projects:recent'),
    create: (name) => invoke('projects:create', name),
    open: (dir) => invoke('projects:open', dir),
    forget: (dir) => invoke('projects:forget', dir)
  },
  project: {
    current: () => invoke('project:current'),
    mutate: (mutation) => invoke('project:mutate', mutation),
    close: () => invoke('project:close'),
    reveal: () => invoke('project:reveal')
  },
  items: {
    load: (kind, id) => invoke('item:load', kind, id),
    reload: (kind, id) => invoke('item:reload', kind, id),
    update: (kind, id, value) => invoke('item:update', kind, id, value),
    flush: (kind, id) => invoke('item:flush', kind, id),
    onStatus: (listener) => subscribe('item:status', listener)
  }
}

contextBridge.exposeInMainWorld('scriptum', api)
