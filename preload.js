const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  openFileDialog: () => ipcRenderer.invoke('open-file-dialog'),
  exportDialog: () => ipcRenderer.invoke('export-dialog'),
  // Duration fallback for files Chromium can't probe (e.g. unsupported codecs).
  getMediaDuration: (filePath) => ipcRenderer.invoke('get-media-duration', filePath),
  exportVideo: (options) => ipcRenderer.invoke('export-video', options),
  cancelExport: () => ipcRenderer.invoke('cancel-export'),
  onExportProgress: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('export-progress', handler);
  },
  removeExportProgressListener: () => {
    ipcRenderer.removeAllListeners('export-progress');
  },
});
