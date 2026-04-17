const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  fs: {
    read: (path) => ipcRenderer.invoke('fs:read', path),
    readBin: (path) => ipcRenderer.invoke('fs:readBin', path),
    writeBin: (path, b64) => ipcRenderer.invoke('fs:writeBin', path, b64),
    write: (path, content) => ipcRenderer.invoke('fs:write', path, content),
    exists: (path) => ipcRenderer.invoke('fs:exists', path),
    mkdir: (path) => ipcRenderer.invoke('fs:mkdir', path),
    readdir: (path) => ipcRenderer.invoke('fs:readdir', path),
    delete: (path) => ipcRenderer.invoke('fs:delete', path),
    rename: (oldPath, newPath) => ipcRenderer.invoke('fs:rename', oldPath, newPath),
    copy: (src, dest) => ipcRenderer.invoke('fs:copy', src, dest),
  },
  store: {
    get: (key) => ipcRenderer.invoke('store:get', key),
    set: (key, value) => ipcRenderer.invoke('store:set', key, value),
    del: (key) => ipcRenderer.invoke('store:del', key),
  },
  dialog: {
    folder: () => ipcRenderer.invoke('dialog:folder'),
    file: (filters) => ipcRenderer.invoke('dialog:file', filters),
    save: (title, defaultName, filters) => ipcRenderer.invoke('dialog:save', title, defaultName, filters),
  },
  shell: {
    open: (path) => ipcRenderer.invoke('shell:open', path),
  },
  app: {
    version: () => ipcRenderer.invoke('app:version'),
  },
  update: {
    check: (token, owner, repo) => ipcRenderer.invoke('update:check', token, owner, repo),
    apply: (token, owner, repo, sha) => ipcRenderer.invoke('update:apply', token, owner, repo, sha),
    restart: () => ipcRenderer.invoke('update:restart'),
  },
  export: {
    pdf: (filePath, options) => ipcRenderer.invoke('export:pdf', filePath, options), // Pass options to main
    docx: (filePath, htmlContent, options) => ipcRenderer.invoke('export:docx', filePath, htmlContent, options), // New DOCX export
  }
})