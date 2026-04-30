const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  minimize:       () => ipcRenderer.send('win-minimize'),
  maximize:       () => ipcRenderer.send('win-maximize'),
  close:          () => ipcRenderer.send('win-close'),
  notify:         (title, body) => ipcRenderer.send('notify', { title, body }),
  listGifs:       () => ipcRenderer.invoke('list-gifs'),
  setAlwaysOnTop: (flag) => ipcRenderer.send('set-always-on-top', flag),
  setFullscreen:  (flag) => ipcRenderer.send('set-fullscreen', flag),
  pickGifFiles:   () => ipcRenderer.invoke('pick-gif-files'),
  readFile:       (path) => ipcRenderer.invoke('read-file', path),
  removeBgFrame:  (pngData) => ipcRenderer.invoke('remove-bg-frame', pngData),
  cacheRead:      (mediaPath) => ipcRenderer.invoke('cache-read', mediaPath),
  cacheWrite:     (mediaPath, pngData) => ipcRenderer.invoke('cache-write', mediaPath, pngData),
  cacheCount:     () => ipcRenderer.invoke('cache-count'),
  cacheClear:     () => ipcRenderer.invoke('cache-clear'),
  showWindow:     () => ipcRenderer.send('show-window'),
  onSystemLock:    (cb) => { const h = () => cb(); ipcRenderer.on('system-lock',    h); return () => ipcRenderer.removeListener('system-lock',    h) },
  onSystemUnlock:  (cb) => { const h = () => cb(); ipcRenderer.on('system-unlock',  h); return () => ipcRenderer.removeListener('system-unlock',  h) },
  onSystemSuspend: (cb) => { const h = () => cb(); ipcRenderer.on('system-suspend', h); return () => ipcRenderer.removeListener('system-suspend', h) },
  onSystemResume:  (cb) => { const h = () => cb(); ipcRenderer.on('system-resume',  h); return () => ipcRenderer.removeListener('system-resume',  h) },
})
