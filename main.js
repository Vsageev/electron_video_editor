const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const { validateProject } = require('./scripts/validateProject.js');

let mainWindow;

function readExactlySync(fd, length, position) {
  const buf = Buffer.allocUnsafe(length);
  const { bytesRead } = fs.readSync(fd, buf, 0, length, position);
  if (bytesRead !== length) throw new Error('Unexpected EOF');
  return buf;
}

function readU64BE(buf, offset) {
  // Node supports BigInt reads, but keep explicit for clarity.
  return buf.readBigUInt64BE(offset);
}

function parseMvhdDurationSeconds(fd, atomStart, atomSize) {
  // mvhd is a FullBox: version(1) + flags(3) then fields depending on version.
  // Version 0: creation(4), modification(4), timescale(4), duration(4)
  // Version 1: creation(8), modification(8), timescale(4), duration(8)
  const header = readExactlySync(fd, 32, atomStart); // enough for both v0 and v1 basics
  const version = header.readUInt8(8); // after size(4)+type(4)
  if (version === 0) {
    const timescale = header.readUInt32BE(20);
    const duration = header.readUInt32BE(24);
    if (!timescale || !duration) return 0;
    return duration / timescale;
  }
  if (version === 1) {
    // Need more bytes for 64-bit duration.
    const buf = readExactlySync(fd, 44, atomStart);
    const timescale = buf.readUInt32BE(28);
    const duration = readU64BE(buf, 32);
    if (!timescale || duration === 0n) return 0;
    return Number(duration) / timescale;
  }
  return 0;
}

function parseMdhdDurationSeconds(fd, atomStart) {
  // mdhd is a FullBox like mvhd but shorter.
  const header = readExactlySync(fd, 32, atomStart);
  const version = header.readUInt8(8);
  if (version === 0) {
    const timescale = header.readUInt32BE(20);
    const duration = header.readUInt32BE(24);
    if (!timescale || !duration) return 0;
    return duration / timescale;
  }
  if (version === 1) {
    const buf = readExactlySync(fd, 44, atomStart);
    const timescale = buf.readUInt32BE(28);
    const duration = readU64BE(buf, 32);
    if (!timescale || duration === 0n) return 0;
    return Number(duration) / timescale;
  }
  return 0;
}

function mp4DurationSeconds(filePath) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const { size: fileSize } = fs.statSync(filePath);

    // Walk top-level atoms to find moov (could be at end).
    let offset = 0;
    while (offset + 8 <= fileSize) {
      const hdr = readExactlySync(fd, 16, offset);
      let atomSize = hdr.readUInt32BE(0);
      const atomType = hdr.toString('ascii', 4, 8);
      let headerSize = 8;
      if (atomSize === 1) {
        atomSize = Number(readU64BE(hdr, 8));
        headerSize = 16;
      } else if (atomSize === 0) {
        atomSize = fileSize - offset;
      }

      if (!atomSize || atomSize < headerSize) break;

      if (atomType === 'moov') {
        const moovStart = offset;
        const moovEnd = offset + atomSize;

        let mvhdSeconds = 0;
        let maxTrackSeconds = 0;

        // Walk children of moov: look for mvhd and for trak->mdia->mdhd.
        let moovChild = moovStart + headerSize;
        while (moovChild + 8 <= moovEnd) {
          const ch = readExactlySync(fd, 16, moovChild);
          let childSize = ch.readUInt32BE(0);
          const childType = ch.toString('ascii', 4, 8);
          let childHeaderSize = 8;
          if (childSize === 1) {
            childSize = Number(readU64BE(ch, 8));
            childHeaderSize = 16;
          } else if (childSize === 0) {
            childSize = moovEnd - moovChild;
          }
          if (!childSize || childSize < childHeaderSize) break;

          if (childType === 'mvhd') {
            mvhdSeconds = parseMvhdDurationSeconds(fd, moovChild, childSize);
          } else if (childType === 'trak') {
            const trakStart = moovChild;
            const trakEnd = moovChild + childSize;
            let trakChild = trakStart + childHeaderSize;

            while (trakChild + 8 <= trakEnd) {
              const t = readExactlySync(fd, 16, trakChild);
              let tSize = t.readUInt32BE(0);
              const tType = t.toString('ascii', 4, 8);
              let tHeader = 8;
              if (tSize === 1) {
                tSize = Number(readU64BE(t, 8));
                tHeader = 16;
              } else if (tSize === 0) {
                tSize = trakEnd - trakChild;
              }
              if (!tSize || tSize < tHeader) break;

              if (tType === 'mdia') {
                const mdiaStart = trakChild;
                const mdiaEnd = trakChild + tSize;
                let mdiaChild = mdiaStart + tHeader;
                while (mdiaChild + 8 <= mdiaEnd) {
                  const m = readExactlySync(fd, 16, mdiaChild);
                  let mSize = m.readUInt32BE(0);
                  const mType = m.toString('ascii', 4, 8);
                  let mHeader = 8;
                  if (mSize === 1) {
                    mSize = Number(readU64BE(m, 8));
                    mHeader = 16;
                  } else if (mSize === 0) {
                    mSize = mdiaEnd - mdiaChild;
                  }
                  if (!mSize || mSize < mHeader) break;

                  if (mType === 'mdhd') {
                    maxTrackSeconds = Math.max(
                      maxTrackSeconds,
                      parseMdhdDurationSeconds(fd, mdiaChild)
                    );
                    break;
                  }

                  mdiaChild += mSize;
                }
                break;
              }

              trakChild += tSize;
            }
          }

          moovChild += childSize;
        }

        const seconds = mvhdSeconds > 0 ? mvhdSeconds : maxTrackSeconds;
        return Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
      }

      offset += atomSize;
    }

    return 0;
  } finally {
    try {
      fs.closeSync(fd);
    } catch {
      // ignore
    }
  }
}

function ffprobeDurationSeconds(filePath) {
  // Best-effort: relies on ffprobe being available on PATH.
  const res = spawnSync(
    'ffprobe',
    [
      '-v',
      'error',
      '-print_format',
      'json',
      '-show_entries',
      'format=duration:stream=duration',
      filePath,
    ],
    {
      encoding: 'utf8',
      timeout: 5000,
      env: {
        ...process.env,
        // GUI-launched Electron often lacks Homebrew PATH; add common locations.
        PATH: ['/opt/homebrew/bin', '/usr/local/bin', process.env.PATH || ''].join(':'),
      },
    }
  );
  if (res.error || res.status !== 0 || !res.stdout) return 0;

  let data;
  try {
    data = JSON.parse(res.stdout);
  } catch {
    return 0;
  }

  const candidates = [];
  const fmtDur = parseFloat(data?.format?.duration);
  if (Number.isFinite(fmtDur) && fmtDur > 0) candidates.push(fmtDur);
  if (Array.isArray(data?.streams)) {
    for (const s of data.streams) {
      const d = parseFloat(s?.duration);
      if (Number.isFinite(d) && d > 0) candidates.push(d);
    }
  }
  return candidates.length ? Math.max(...candidates) : 0;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    backgroundColor: '#000000',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, 'dist', 'index.html'));
  }
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

ipcMain.handle('open-file-dialog', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Video Files', extensions: ['mp4', 'webm', 'mov', 'avi', 'mkv', 'ogg'] },
      { name: 'Audio Files', extensions: ['mp3', 'wav', 'ogg', 'aac', 'flac'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });

  if (result.canceled) return [];

  return result.filePaths.map((filePath) => ({
    path: filePath,
    name: path.basename(filePath),
    ext: path.extname(filePath).toLowerCase(),
  }));
});

ipcMain.handle('export-dialog', async () => {
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: 'output.webm',
    filters: [{ name: 'WebM Video', extensions: ['webm'] }],
  });

  if (result.canceled) return null;
  return result.filePath;
});

// ---------------------------------------------------------------------------
// Save blob from renderer to disk
// ---------------------------------------------------------------------------

ipcMain.handle('save-blob', async (_evt, { outputPath, buffer }) => {
  try {
    await fs.promises.writeFile(outputPath, Buffer.from(buffer));
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('read-file', async (_evt, filePath) => {
  const buf = await fs.promises.readFile(filePath);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
});

// ---------------------------------------------------------------------------
// API Keys persistence (stored in .env in project folder)
// ---------------------------------------------------------------------------

const envPath = path.join(__dirname, '.env');

function readApiKeys() {
  try {
    const content = fs.readFileSync(envPath, 'utf8');
    const keys = {};
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      // Strip surrounding quotes
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (key) keys[key] = val;
    }
    return keys;
  } catch {
    return {};
  }
}

function writeApiKeys(keys) {
  const lines = Object.entries(keys)
    .filter(([k]) => k.trim())
    .map(([k, v]) => `${k}=${v}`);
  fs.writeFileSync(envPath, lines.join('\n') + '\n', 'utf8');
}

ipcMain.handle('get-api-keys', () => readApiKeys());

ipcMain.handle('set-api-keys', (_evt, keys) => {
  writeApiKeys(keys);
  return { success: true };
});

// ---------------------------------------------------------------------------
// Project file watching – detect external edits to project.json
// ---------------------------------------------------------------------------

let projectWatcher = null;
let lastSaveTimestamp = 0; // used to ignore self-triggered change events

function watchProjectFile(projectName) {
  unwatchProjectFile();
  const filePath = path.join(__dirname, 'projects', projectName, 'project.json');
  if (!fs.existsSync(filePath)) return;

  projectWatcher = fs.watch(filePath, { persistent: false }, (eventType) => {
    if (eventType !== 'change') return;
    // Ignore changes caused by our own saves (within 2s window)
    if (Date.now() - lastSaveTimestamp < 2000) return;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('project-file-changed');
    }
  });
}

function unwatchProjectFile() {
  if (projectWatcher) {
    projectWatcher.close();
    projectWatcher = null;
  }
}

ipcMain.handle('watch-project', (_evt, name) => {
  watchProjectFile(name);
});

ipcMain.handle('unwatch-project', () => {
  unwatchProjectFile();
});

// ---------------------------------------------------------------------------
// Project management
// ---------------------------------------------------------------------------

const projectsDir = path.join(__dirname, 'projects');

function ensureProjectsDir() {
  if (!fs.existsSync(projectsDir)) fs.mkdirSync(projectsDir, { recursive: true });
}

ipcMain.handle('list-projects', async () => {
  ensureProjectsDir();
  const entries = await fs.promises.readdir(projectsDir, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory() && e.name !== '.last')
    .map((e) => e.name)
    .sort();
});

ipcMain.handle('create-project', async (_evt, name) => {
  ensureProjectsDir();
  const dir = path.join(projectsDir, name);
  await fs.promises.mkdir(path.join(dir, 'media'), { recursive: true });
  return { success: true };
});

ipcMain.handle('load-project', async (_evt, name) => {
  const filePath = path.join(projectsDir, name, 'project.json');
  try {
    const raw = await fs.promises.readFile(filePath, 'utf8');
    let data;
    try {
      data = JSON.parse(raw);
    } catch (parseErr) {
      return { success: false, error: `Invalid JSON: ${parseErr.message}` };
    }

    // Validate project structure and integrity
    const projectDir = path.join(projectsDir, name);
    const { structureErrors, integrityErrors, warnings } = validateProject(data, projectDir);
    if (structureErrors.length > 0 || integrityErrors.length > 0) {
      const allErrors = [...structureErrors, ...integrityErrors];
      return { success: false, error: allErrors.join('; ') };
    }

    return { success: true, data, warnings };
  } catch (err) {
    if (err.code === 'ENOENT') {
      return { success: false, error: 'project.json not found' };
    }
    return { success: false, error: err.message };
  }
});

ipcMain.handle('save-project', async (_evt, name, data) => {
  ensureProjectsDir();
  const dir = path.join(projectsDir, name);
  await fs.promises.mkdir(path.join(dir, 'media'), { recursive: true });
  const filePath = path.join(dir, 'project.json');
  const tmpPath = filePath + '.tmp';
  try {
    await fs.promises.writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf8');
    await fs.promises.rename(tmpPath, filePath);
    lastSaveTimestamp = Date.now();
    return { success: true };
  } catch (err) {
    // Clean up tmp if rename failed
    try { await fs.promises.unlink(tmpPath); } catch {}
    return { success: false, error: err.message };
  }
});

ipcMain.handle('copy-media-to-project', async (_evt, projectName, sourcePath) => {
  const mediaDir = path.join(projectsDir, projectName, 'media');
  await fs.promises.mkdir(mediaDir, { recursive: true });
  const fileName = path.basename(sourcePath);
  const destPath = path.join(mediaDir, fileName);

  // Deduplicate: if already exists and same size, skip copy
  try {
    const srcStat = await fs.promises.stat(sourcePath);
    const destStat = await fs.promises.stat(destPath);
    if (srcStat.size === destStat.size) {
      return { success: true, relativePath: 'media/' + fileName };
    }
  } catch {
    // dest doesn't exist yet, proceed with copy
  }

  // Handle name collision: add numeric suffix
  let finalName = fileName;
  let finalDest = destPath;
  const ext = path.extname(fileName);
  const base = path.basename(fileName, ext);
  let counter = 1;
  while (true) {
    try {
      await fs.promises.access(finalDest);
      // file exists with different size, try next name
      finalName = `${base}_${counter}${ext}`;
      finalDest = path.join(mediaDir, finalName);
      counter++;
    } catch {
      break; // file doesn't exist, use this name
    }
  }

  await fs.promises.copyFile(sourcePath, finalDest);

  // Create empty metadata sidecar file if it doesn't exist
  const mdPath = finalDest + '.md';
  try {
    await fs.promises.access(mdPath);
  } catch {
    await fs.promises.writeFile(mdPath, '', 'utf8');
  }

  return { success: true, relativePath: 'media/' + finalName };
});

ipcMain.handle('get-last-project', async () => {
  const lastFile = path.join(projectsDir, '.last');
  try {
    const name = (await fs.promises.readFile(lastFile, 'utf8')).trim();
    if (!name) return null;
    // Verify project dir still exists
    const dir = path.join(projectsDir, name);
    if (fs.existsSync(path.join(dir, 'project.json'))) return name;
    return null;
  } catch {
    return null;
  }
});

ipcMain.handle('set-last-project', async (_evt, name) => {
  ensureProjectsDir();
  await fs.promises.writeFile(path.join(projectsDir, '.last'), name, 'utf8');
});

ipcMain.handle('delete-project', async (_evt, name) => {
  const dir = path.join(projectsDir, name);
  try {
    await fs.promises.rm(dir, { recursive: true, force: true });
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('get-project-dir', async (_evt, name) => {
  return path.join(projectsDir, name);
});

// ---------------------------------------------------------------------------
// Media metadata (.md sidecar files)
// ---------------------------------------------------------------------------

ipcMain.handle('read-media-metadata', async (_evt, mediaFilePath) => {
  const mdPath = mediaFilePath + '.md';
  try {
    return await fs.promises.readFile(mdPath, 'utf8');
  } catch {
    return '';
  }
});

ipcMain.handle('write-media-metadata', async (_evt, mediaFilePath, content) => {
  const mdPath = mediaFilePath + '.md';
  try {
    await fs.promises.writeFile(mdPath, content, 'utf8');
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('get-media-duration', async (_evt, filePath) => {
  try {
    const ext = path.extname(filePath).toLowerCase();
    // Fast, dependency-free parsing for ISO BMFF containers. This works even if
    // Chromium can't decode the codec (e.g. HEVC in MP4) and thus reports 0s.
    if (ext === '.mp4' || ext === '.mov' || ext === '.m4v' || ext === '.m4a') {
      const seconds = mp4DurationSeconds(filePath);
      if (seconds > 0) return seconds;
    }

    // Optional fallback for everything else (or if MP4 parsing failed).
    const ffSeconds = ffprobeDurationSeconds(filePath);
    return ffSeconds > 0 ? ffSeconds : 0;
  } catch {
    return 0;
  }
});
