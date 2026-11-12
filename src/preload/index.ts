import { contextBridge, ipcRenderer } from 'electron'
import type { IpcArgs, IpcChannel, IpcResult, ScriptumApi } from '@shared/ipc'

function invoke<C extends IpcChannel>(channel: C, ...args: IpcArgs<C>): Promise<IpcResult<C>> {
  return ipcRenderer.invoke(channel, ...args) as Promise<IpcResult<C>>
}

const api: ScriptumApi = {
  app: {
    getInfo: () => invoke('app:getInfo')
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
  }
}

contextBridge.exposeInMainWorld('scriptum', api)
