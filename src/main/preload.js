const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('api', {
  store: { get: (k) => ipcRenderer.invoke('store:get', k), set: (k, v) => ipcRenderer.invoke('store:set', k, v) },
  dialog: { openFolder: () => ipcRenderer.invoke('dialog:openFolder'), openFile: (f) => ipcRenderer.invoke('dialog:openFile', f), saveFile: (o) => ipcRenderer.invoke('dialog:saveFile', o) },
  fs: {
    readFile: (p) => ipcRenderer.invoke('fs:readFile', p),
    writeFile: (p, c) => ipcRenderer.invoke('fs:writeFile', p, c),
    readDir: (p) => ipcRenderer.invoke('fs:readDir', p),
    exists: (p) => ipcRenderer.invoke('fs:exists', p),
    mkdir: (p) => ipcRenderer.invoke('fs:mkdir', p),
    rename: (o, n) => ipcRenderer.invoke('fs:rename', o, n),
    delete: (p) => ipcRenderer.invoke('fs:delete', p),
    copyFile: (s, d) => ipcRenderer.invoke('fs:copyFile', s, d),
    readFileBinary: (p) => ipcRenderer.invoke('fs:readFileBinary', p),
  },
  shell: { openPath: (p) => ipcRenderer.invoke('shell:openPath', p) },
  keychain: { getToken: () => ipcRenderer.invoke('keychain:getToken'), setToken: (t) => ipcRenderer.invoke('keychain:setToken', t), deleteToken: () => ipcRenderer.invoke('keychain:deleteToken') },
  platform: process.platform,
});
