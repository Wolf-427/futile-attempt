/**
 * The single contract between the main process and the renderer.
 *
 * The renderer never touches the file system. Every capability it has is one
 * entry in this map: a channel name, its arguments and its result. Main
 * registers a handler per entry, the preload exposes one function per entry,
 * and TypeScript checks both sides against this file.
 */

export interface AppInfo {
  name: string
  version: string
  platform: string
  electron: string
  chrome: string
}

export interface IpcContract {
  'app:getInfo': { args: []; result: AppInfo }
}

export type IpcChannel = keyof IpcContract
export type IpcArgs<C extends IpcChannel> = IpcContract[C]['args']
export type IpcResult<C extends IpcChannel> = IpcContract[C]['result']

/** Runtime list of channels. Typed so it cannot drift from the contract. */
export const IPC_CHANNELS = ['app:getInfo'] as const satisfies readonly IpcChannel[]

type Missing = Exclude<IpcChannel, (typeof IPC_CHANNELS)[number]>
// Compile error here means a channel was added to IpcContract but not to IPC_CHANNELS.
const _exhaustive: Missing extends never ? true : never = true
void _exhaustive

export function isIpcChannel(value: unknown): value is IpcChannel {
  return typeof value === 'string' && (IPC_CHANNELS as readonly string[]).includes(value)
}

/** The object the preload exposes as `window.scriptum`. */
export interface ScriptumApi {
  app: {
    getInfo(): Promise<AppInfo>
  }
}
