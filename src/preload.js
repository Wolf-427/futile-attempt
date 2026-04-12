const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  store: {
    get: (k)    => ipcRenderer.invoke('store:get', k),
    set: (k, v) => ipcRenderer.invoke('store:set', k, v),
    del: (k)    => ipcRenderer.invoke('store:del', k),
  },
  fs: {
    read:    (p)    => ipcRenderer.invoke('fs:read', p),
    readBin: (p)    => ipcRenderer.invoke('fs:readBin', p),
    write:   (p, c) => ipcRenderer.invoke('fs:write', p, c),
    exists:  (p)    => ipcRenderer.invoke('fs:exists', p),
    mkdir:   (p)    => ipcRenderer.invoke('fs:mkdir', p),
    readdir: (p)    => ipcRenderer.invoke('fs:readdir', p),
    delete:  (p)    => ipcRenderer.invoke('fs:delete', p),
    rename:  (a, b) => ipcRenderer.invoke('fs:rename', a, b),
    copy:    (a, b) => ipcRenderer.invoke('fs:copy', a, b),
  },
  dialog: {
    folder: ()  => ipcRenderer.invoke('dialog:folder'),
    file:   (f) => ipcRenderer.invoke('dialog:file', f),
  },
  shell:   { open: (p) => ipcRenderer.invoke('shell:open', p) },
  app:     { version: () => ipcRenderer.invoke('app:version') },
  updater: {
    check:   (t, o, r)    => ipcRenderer.invoke('update:check', t, o, r),
    apply:   (t, o, r, s) => ipcRenderer.invoke('update:apply', t, o, r, s),
    restart: ()            => ipcRenderer.invoke('update:restart'),
  },
})
