import { app, ipcMain, type IpcMainInvokeEvent } from 'electron'
import type { IpcArgs, IpcChannel, IpcResult } from '@shared/ipc'

type Handler<C extends IpcChannel> = (
  event: IpcMainInvokeEvent,
  ...args: IpcArgs<C>
) => IpcResult<C> | Promise<IpcResult<C>>

function handle<C extends IpcChannel>(channel: C, handler: Handler<C>): void {
  ipcMain.handle(channel, (event, ...args) => handler(event, ...(args as IpcArgs<C>)))
}

export function registerIpc(): void {
  handle('app:getInfo', () => ({
    name: app.getName(),
    version: app.getVersion(),
    platform: process.platform,
    electron: process.versions.electron ?? '',
    chrome: process.versions.chrome ?? ''
  }))
}
