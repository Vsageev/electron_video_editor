const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  openFileDialog: () => ipcRenderer.invoke('open-file-dialog'),
  exportDialog: () => ipcRenderer.invoke('export-dialog'),
  // Duration fallback for files Chromium can't probe (e.g. unsupported codecs).
  getMediaDuration: (filePath) => ipcRenderer.invoke('get-media-duration', filePath),
  saveBlob: (outputPath, buffer) => ipcRenderer.invoke('save-blob', { outputPath, buffer }),
  readFile: (filePath) => ipcRenderer.invoke('read-file', filePath),
});
