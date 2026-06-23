// Exposes a minimal, typed-by-convention `window.nativeAPI` to the renderer. This
// is the ONLY bridge between the web app and Electron; the web app feature-detects
// it (see app-web/src/lib/platform) and never imports Electron itself.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('nativeAPI', {
  platform: process.platform,
  openFiles: (opts) => ipcRenderer.invoke('open-files', opts),
  saveFile: (suggestedName, bytes) => ipcRenderer.invoke('save-file', suggestedName, bytes),
  onMenu: (cb) => ipcRenderer.on('menu', (_e, action) => cb(action)),
});
