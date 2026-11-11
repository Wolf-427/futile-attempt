import { contextBridge, ipcRenderer } from 'electron'
import type { IpcArgs, IpcChannel, IpcResult, ScriptumApi } from '@shared/ipc'

function invoke<C extends IpcChannel>(channel: C, ...args: IpcArgs<C>): Promise<IpcResult<C>> {
  return ipcRenderer.invoke(channel, ...args) as Promise<IpcResult<C>>
}

const api: ScriptumApi = {
  app: {
    getInfo: () => invoke('app:getInfo')
  }
}

contextBridge.exposeInMainWorld('scriptum', api)
