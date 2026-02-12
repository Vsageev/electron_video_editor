const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  openFileDialog: () => ipcRenderer.invoke('open-file-dialog'),
  exportDialog: () => ipcRenderer.invoke('export-dialog'),
  // Duration fallback for files Chromium can't probe (e.g. unsupported codecs).
  getMediaDuration: (filePath) => ipcRenderer.invoke('get-media-duration', filePath),
  saveBlob: (outputPath, buffer) => ipcRenderer.invoke('save-blob', { outputPath, buffer }),
  readFile: (filePath) => ipcRenderer.invoke('read-file', filePath),
  getApiKeys: () => ipcRenderer.invoke('get-api-keys'),
  setApiKeys: (keys) => ipcRenderer.invoke('set-api-keys', keys),

  // Project management
  listProjects: () => ipcRenderer.invoke('list-projects'),
  createProject: (name) => ipcRenderer.invoke('create-project', name),
  loadProject: (name) => ipcRenderer.invoke('load-project', name),
  saveProject: (name, data) => ipcRenderer.invoke('save-project', name, data),
  copyMediaToProject: (projectName, sourcePath) =>
    ipcRenderer.invoke('copy-media-to-project', projectName, sourcePath),
  deleteMediaFromProject: (projectName, relativePath) =>
    ipcRenderer.invoke('delete-media-from-project', projectName, relativePath),
  getLastProject: () => ipcRenderer.invoke('get-last-project'),
  setLastProject: (name) => ipcRenderer.invoke('set-last-project', name),
  deleteProject: (name) => ipcRenderer.invoke('delete-project', name),
  getProjectDir: (name) => ipcRenderer.invoke('get-project-dir', name),

  // Media metadata
  readMediaMetadata: (mediaFilePath) => ipcRenderer.invoke('read-media-metadata', mediaFilePath),
  writeMediaMetadata: (mediaFilePath, content) => ipcRenderer.invoke('write-media-metadata', mediaFilePath, content),

  // Component bundling
  bundleComponent: (projectName, sourcePath) =>
    ipcRenderer.invoke('bundle-component', projectName, sourcePath),

  // Built-in components
  listBuiltinComponents: () => ipcRenderer.invoke('list-builtin-components'),
  addBuiltinComponent: (projectName, fileName) =>
    ipcRenderer.invoke('add-builtin-component', projectName, fileName),

  // Tools
  checkRembg: () => ipcRenderer.invoke('check-rembg'),
  installRembg: () => ipcRenderer.invoke('install-rembg'),
  onRembgInstallLog: (callback) => {
    const handler = (_evt, log) => callback(log);
    ipcRenderer.on('rembg-install-log', handler);
    return () => ipcRenderer.removeListener('rembg-install-log', handler);
  },
  removeBackground: (projectName, relativePath) =>
    ipcRenderer.invoke('remove-background', projectName, relativePath),
  cancelRemoveBackground: () => ipcRenderer.invoke('cancel-remove-background'),
  onRembgProgress: (callback) => {
    const handler = (_evt, stage) => callback(stage);
    ipcRenderer.on('rembg-progress', handler);
    return () => ipcRenderer.removeListener('rembg-progress', handler);
  },

  // Audio transcription
  transcribeAudio: (projectName, relativePath) =>
    ipcRenderer.invoke('transcribe-audio', projectName, relativePath),
  onTranscribeProgress: (callback) => {
    const handler = (_evt, msg) => callback(msg);
    ipcRenderer.on('transcribe-progress', handler);
    return () => ipcRenderer.removeListener('transcribe-progress', handler);
  },

  // Project file watching
  watchProject: (name) => ipcRenderer.invoke('watch-project', name),
  unwatchProject: () => ipcRenderer.invoke('unwatch-project'),
  onProjectFileChanged: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('project-file-changed', handler);
    return () => ipcRenderer.removeListener('project-file-changed', handler);
  },
});
