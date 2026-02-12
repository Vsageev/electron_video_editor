const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const https = require('https');
const { spawnSync, execFile, spawn } = require('child_process');
const { bundleComponent } = require('./scripts/bundleComponent.js');
const { validateProject } = require('./scripts/validateProject.js');
const { listBuiltinComponents, addBuiltinComponent } = require('./scripts/builtinComponents.js');

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
      // Windows defaults to the first filter; put a combined filter first so users
      // don't have to manually switch "file type" in Explorer to import audio/etc.
      {
        name: 'All Supported',
        extensions: ['mp4', 'webm', 'mov', 'avi', 'mkv', 'ogg', 'mp3', 'wav', 'aac', 'flac', 'tsx', 'jsx', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'],
      },
      { name: 'Video Files', extensions: ['mp4', 'webm', 'mov', 'avi', 'mkv', 'ogg'] },
      { name: 'Image Files', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'] },
      { name: 'Audio Files', extensions: ['mp3', 'wav', 'ogg', 'aac', 'flac'] },
      { name: 'Components', extensions: ['tsx', 'jsx'] },
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

function normalizePathSeparators(p) {
  return typeof p === 'string' ? p.replaceAll('\\', '/') : p;
}

function toProjectRelativePathMaybe(filePath, projectDir) {
  if (typeof filePath !== 'string' || typeof projectDir !== 'string') return null;
  const fp = normalizePathSeparators(filePath);
  const dir = normalizePathSeparators(projectDir).replace(/\/+$/, '');
  return fp.startsWith(dir + '/') ? fp.slice(dir.length + 1) : null;
}

function sanitizeProjectMediaReferences(data, projectDir) {
  if (!data || typeof data !== 'object') return;
  if (!Array.isArray(data.mediaFiles) || !Array.isArray(data.timelineClips)) return;

  // Normalize mediaFiles paths first so downstream lookups are consistent.
  const mediaPathSet = new Set();
  const mediaByPath = new Map();
  for (const mf of data.mediaFiles) {
    if (!mf || typeof mf !== 'object' || typeof mf.path !== 'string') continue;
    const relMediaPath = toProjectRelativePathMaybe(mf.path, projectDir);
    if (relMediaPath) mf.path = relMediaPath;
    mediaPathSet.add(mf.path);
    mediaByPath.set(mf.path, mf);
  }

  for (const clip of data.timelineClips) {
    if (!clip || typeof clip !== 'object') continue;
    if (typeof clip.mediaPath === 'string') {
      const relClipPath = toProjectRelativePathMaybe(clip.mediaPath, projectDir);
      if (relClipPath) clip.mediaPath = relClipPath;
    }

    if (!clip.componentProps || typeof clip.componentProps !== 'object') continue;

    const clipMedia = typeof clip.mediaPath === 'string' ? mediaByPath.get(clip.mediaPath) : undefined;
    const propDefinitions = clipMedia && typeof clipMedia.propDefinitions === 'object' ? clipMedia.propDefinitions : undefined;
    if (!propDefinitions) continue;

    for (const [propName, def] of Object.entries(propDefinitions)) {
      if (!def || typeof def !== 'object') continue;
      if (def.type !== 'media' && def.type !== 'component') continue;
      const rawValue = clip.componentProps[propName];
      if (typeof rawValue !== 'string' || rawValue === '') continue;

      const relRef = toProjectRelativePathMaybe(rawValue, projectDir);
      const normalizedRef = relRef || rawValue;
      if (mediaPathSet.has(normalizedRef)) {
        clip.componentProps[propName] = normalizedRef;
      } else {
        // Stale media refs must be recoverable instead of surfacing repeated warnings/crashes.
        clip.componentProps[propName] = '';
      }
    }
  }
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
    sanitizeProjectMediaReferences(data, projectDir);
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

ipcMain.handle('delete-media-from-project', async (_evt, projectName, relativePath) => {
  try {
    const filePath = path.join(projectsDir, projectName, relativePath);
    // Safety: ensure the resolved path is inside the project directory
    const projectDir = path.join(projectsDir, projectName);
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(path.resolve(projectDir) + path.sep)) {
      return { success: false, error: 'Invalid path' };
    }
    await fs.promises.unlink(resolved);
    // Also remove the metadata sidecar if it exists
    try { await fs.promises.unlink(resolved + '.md'); } catch {}
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
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
    // Images have no intrinsic duration; return a default of 5 seconds
    const imageExts = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'];
    if (imageExts.includes(ext)) return 5;

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

// ---------------------------------------------------------------------------
// Component bundling (TSX/JSX → IIFE via esbuild)
// ---------------------------------------------------------------------------

ipcMain.handle('bundle-component', async (_evt, projectName, sourcePath) => {
  try {
    const mediaDir = path.join(projectsDir, projectName, 'media');
    const baseName = path.basename(sourcePath, path.extname(sourcePath));
    const outFile = path.join(mediaDir, `${baseName}.component.js`);

    const result = await bundleComponent(sourcePath, outFile);
    if (!result.success) return result;

    const relativePath = 'media/' + path.basename(outFile);
    return { success: true, bundlePath: relativePath };
  } catch (err) {
    return { success: false, error: err.message || String(err) };
  }
});

// ---------------------------------------------------------------------------
// Built-in components
// ---------------------------------------------------------------------------

const builtinComponentsDir = path.join(__dirname, 'builtinComponents');

ipcMain.handle('list-builtin-components', async () => {
  return await listBuiltinComponents(builtinComponentsDir);
});

ipcMain.handle('add-builtin-component', async (_evt, projectName, fileName) => {
  return await addBuiltinComponent({
    builtinDir: builtinComponentsDir,
    projectsDir,
    projectName,
    fileName,
    bundleComponent,
  });
});

// ---------------------------------------------------------------------------
// Tools — Image background removal via rembg
// ---------------------------------------------------------------------------

// Augmented PATH so GUI-launched Electron can find pip-installed CLIs
function getAugmentedPath() {
  const home = process.env.HOME || '';
  const extra = [
    '/opt/homebrew/bin',
    '/usr/local/bin',
    path.join(home, '.local', 'bin'),
  ];
  // macOS: pip --user installs scripts to ~/Library/Python/3.x/bin/
  try {
    const dirs = fs.readdirSync(path.join(home, 'Library', 'Python'));
    for (const ver of dirs) {
      extra.push(path.join(home, 'Library', 'Python', ver, 'bin'));
    }
  } catch { /* dir doesn't exist — not macOS or no user installs */ }
  extra.push(process.env.PATH || '');
  return extra.join(':');
}

function getAugmentedEnv() {
  return { ...process.env, PATH: getAugmentedPath() };
}

// Python interpreters to try — pip may install into a different version than `python3`
const PYTHON_CANDIDATES = ['python3', 'python3.13', 'python3.12', 'python3.11', 'python3.10', 'python3.9', 'python'];

// Cached path of the Python interpreter that has rembg installed
let _rembgPython = null;

// Find a Python interpreter that can import rembg (including its onnxruntime dependency)
// We check `from rembg.bg import remove` instead of just `import rembg` because the
// top-level import can succeed even when onnxruntime is missing — the deeper import
// exercises the full dependency chain.
const REMBG_IMPORT_CHECK = 'from rembg.bg import remove';
const REMBG_FILE_REMOVE_SCRIPT = [
  'import sys, time',
  'print("rembg:stage:importing", flush=True)',
  'from rembg.bg import remove',
  '',
  'input_path = sys.argv[1]',
  'output_path = sys.argv[2]',
  '',
  'print("rembg:stage:reading", flush=True)',
  'with open(input_path, "rb") as f:',
  '    input_bytes = f.read()',
  '',
  'print("rembg:stage:processing", flush=True)',
  'output_bytes = remove(input_bytes)',
  '',
  'print("rembg:stage:writing", flush=True)',
  'with open(output_path, "wb") as f:',
  '    f.write(output_bytes)',
  'print("rembg:stage:done", flush=True)',
].join('\n');

// Active rembg child process — allows cancellation from renderer
let _activeRembgProcess = null;

function findPythonWithRembg() {
  const augEnv = getAugmentedEnv();
  // Try cached interpreter first
  if (_rembgPython) {
    const r = spawnSync(_rembgPython, ['-c', REMBG_IMPORT_CHECK], { encoding: 'utf8', timeout: 15000, env: augEnv });
    if (!r.error && r.status === 0) return _rembgPython;
    _rembgPython = null;
  }
  for (const py of PYTHON_CANDIDATES) {
    const r = spawnSync(py, ['-c', REMBG_IMPORT_CHECK], { encoding: 'utf8', timeout: 15000, env: augEnv });
    if (!r.error && r.status === 0) {
      _rembgPython = py;
      return py;
    }
  }
  return null;
}

// Find any available Python interpreter
function findPython() {
  const augEnv = getAugmentedEnv();
  for (const py of PYTHON_CANDIDATES) {
    const r = spawnSync(py, ['--version'], { encoding: 'utf8', timeout: 5000, env: augEnv });
    if (!r.error && r.status === 0) return py;
  }
  return null;
}

ipcMain.handle('check-rembg', async () => {
  const hasPython = !!findPython();
  const hasRembg = !!findPythonWithRembg();
  return { hasPython, hasRembg };
});

ipcMain.handle('install-rembg', async () => {
  const augEnv = getAugmentedEnv();

  // Find which Python interpreters actually exist so we don't waste time on missing ones
  const availablePythons = [];
  for (const py of PYTHON_CANDIDATES) {
    const r = spawnSync(py, ['--version'], { encoding: 'utf8', timeout: 5000, env: augEnv });
    if (!r.error && r.status === 0) availablePythons.push(py);
  }

  // Build install commands: use `python -m pip` to target the right interpreter.
  // Explicitly install onnxruntime alongside rembg[cli] — pip doesn't always resolve it.
  // --upgrade: fixes broken/partial installs; --no-cache-dir: avoids stale cached wheels.
  const pipFlags = ['install', '--upgrade', '--no-cache-dir', 'rembg[cli]', 'onnxruntime'];
  const installCommands = [];
  for (const py of availablePythons) {
    installCommands.push({ cmd: py, args: ['-m', 'pip', ...pipFlags] });
  }
  // Fall back to bare pip only if no Python interpreters were found
  if (availablePythons.length === 0) {
    installCommands.push({ cmd: 'pip3', args: pipFlags });
    installCommands.push({ cmd: 'pip', args: pipFlags });
  }

  let lastOutput = '';
  let lastError = '';

  for (const { cmd, args } of installCommands) {
    const result = await new Promise((resolve) => {
      const proc = spawn(cmd, args, {
        env: augEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let output = '';
      const sendLog = (chunk) => {
        output += chunk;
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('rembg-install-log', output);
        }
      };

      proc.stdout.on('data', (data) => sendLog(data.toString()));
      proc.stderr.on('data', (data) => sendLog(data.toString()));

      const timeout = setTimeout(() => {
        proc.kill();
        resolve({ status: 'timeout', output });
      }, 300000);

      proc.on('error', (err) => {
        clearTimeout(timeout);
        resolve({ status: err.code === 'ENOENT' ? 'not_found' : 'error', error: err.message, output });
      });

      proc.on('close', (code) => {
        clearTimeout(timeout);
        resolve({ status: code === 0 ? 'ok' : 'fail', code, output });
      });
    });

    lastOutput = result.output || lastOutput;

    if (result.status === 'not_found') continue;
    if (result.status === 'timeout') return { success: false, error: 'Installation timed out after 5 minutes', log: lastOutput };
    if (result.status === 'error') { lastError = result.error; continue; }
    // Non-zero exit: try next candidate instead of giving up immediately
    if (result.status === 'fail') { lastError = `Installation failed (exit code ${result.code})`; continue; }

    // pip succeeded — verify rembg is fully importable (including onnxruntime)
    _rembgPython = null;
    const pyWithRembg = findPythonWithRembg();
    if (!pyWithRembg) {
      // Diagnose what's actually missing
      const diagPy = availablePythons[0] || 'python3';
      const diag = spawnSync(diagPy, ['-c', REMBG_IMPORT_CHECK], { encoding: 'utf8', timeout: 15000, env: augEnv });
      const diagMsg = diag.stderr?.trim() || '';
      const hint = diagMsg.includes('onnxruntime')
        ? `onnxruntime failed to install. Try manually: ${diagPy} -m pip install onnxruntime`
        : `rembg installed but cannot import. Try manually: ${diagPy} -m pip install rembg[cli]`;
      return { success: false, error: hint, log: lastOutput + (diagMsg ? '\n\nDiagnostic:\n' + diagMsg : '') };
    }
    return { success: true, log: lastOutput };
  }

  return { success: false, error: lastError || 'pip not found. Please install Python 3 first: python.org/downloads', log: lastOutput };
});

// ---------------------------------------------------------------------------
// Audio transcription via OpenAI Whisper API
// ---------------------------------------------------------------------------

ipcMain.handle('transcribe-audio', async (_evt, projectName, mediaRelativePath) => {
  const keys = readApiKeys();
  const apiKey = keys.OPENAI_API_KEY;
  if (!apiKey) {
    return { success: false, error: 'OPENAI_API_KEY not set. Configure it in Settings.' };
  }

  const projectDir = path.join(projectsDir, projectName);
  const inputPath = path.join(projectDir, mediaRelativePath);
  const resolved = path.resolve(inputPath);
  if (!resolved.startsWith(path.resolve(projectDir) + path.sep)) {
    return { success: false, error: 'Invalid path' };
  }

  const sendProgress = (msg) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('transcribe-progress', msg);
    }
  };

  const ext = path.extname(resolved).toLowerCase();
  const audioExts = ['.mp3', '.wav', '.ogg', '.aac', '.flac', '.m4a', '.webm'];
  const isAudioFile = audioExts.includes(ext);

  let audioFilePath = resolved;
  let tempFile = null;

  try {
    // For video files (or large audio), extract/compress audio via ffmpeg
    if (!isAudioFile) {
      const augEnv = getAugmentedEnv();

      // Probe for audio streams first
      sendProgress('Checking for audio...');
      const hasAudio = await new Promise((resolve) => {
        const probe = spawnSync('ffprobe', [
          '-v', 'error',
          '-select_streams', 'a',
          '-show_entries', 'stream=codec_type',
          '-of', 'csv=p=0',
          resolved,
        ], { encoding: 'utf8', timeout: 10000, env: augEnv });
        resolve(!probe.error && probe.status === 0 && (probe.stdout || '').trim().length > 0);
      });

      if (!hasAudio) {
        return { success: false, error: 'This video file has no audio track. Subtitles require audio to transcribe.' };
      }

      sendProgress('Extracting audio...');
      tempFile = path.join(os.tmpdir(), `editor_transcribe_${Date.now()}.mp3`);

      await new Promise((resolve, reject) => {
        const proc = spawn('ffmpeg', [
          '-i', resolved,
          '-vn', '-ac', '1', '-ar', '16000', '-b:a', '64k', '-f', 'mp3',
          '-y', tempFile,
        ], { env: augEnv, stdio: ['ignore', 'pipe', 'pipe'] });

        let stderr = '';
        proc.stderr.on('data', (d) => { stderr += d.toString(); });

        proc.on('error', (err) => {
          if (err.code === 'ENOENT') {
            reject(new Error('ffmpeg not found. Install ffmpeg to extract audio from video files.'));
          } else {
            reject(err);
          }
        });

        proc.on('close', (code) => {
          if (code !== 0) reject(new Error(`ffmpeg failed (exit ${code}): ${stderr.slice(-500)}`));
          else resolve();
        });
      });

      audioFilePath = tempFile;
    } else {
      // Check if audio file is over 25MB — if so, compress via ffmpeg
      const stat = await fs.promises.stat(resolved);
      if (stat.size > 25 * 1024 * 1024) {
        sendProgress('Compressing audio...');
        tempFile = path.join(os.tmpdir(), `editor_transcribe_${Date.now()}.mp3`);
        const augEnv = getAugmentedEnv();

        await new Promise((resolve, reject) => {
          const proc = spawn('ffmpeg', [
            '-i', resolved,
            '-vn', '-ac', '1', '-ar', '16000', '-b:a', '64k', '-f', 'mp3',
            '-y', tempFile,
          ], { env: augEnv, stdio: ['ignore', 'pipe', 'pipe'] });

          let stderr = '';
          proc.stderr.on('data', (d) => { stderr += d.toString(); });

          proc.on('error', (err) => {
            if (err.code === 'ENOENT') {
              reject(new Error('ffmpeg not found. Install ffmpeg to compress large audio files.'));
            } else {
              reject(err);
            }
          });

          proc.on('close', (code) => {
            if (code !== 0) reject(new Error(`ffmpeg failed (exit ${code}): ${stderr.slice(-500)}`));
            else resolve();
          });
        });

        audioFilePath = tempFile;
      }
    }

    sendProgress('Transcribing with Whisper...');

    // Build multipart form data
    const fileData = await fs.promises.readFile(audioFilePath);
    const boundary = '----FormBoundary' + Date.now().toString(36) + Math.random().toString(36).slice(2);
    const fileName = path.basename(audioFilePath);

    const fields = [
      ['model', 'whisper-1'],
      ['response_format', 'verbose_json'],
      ['timestamp_granularities[]', 'segment'],
    ];

    const parts = [];
    for (const [name, value] of fields) {
      parts.push(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`
      );
    }

    const fileHeader = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: application/octet-stream\r\n\r\n`;
    const fileFooter = `\r\n--${boundary}--\r\n`;

    const headerBuf = Buffer.from(parts.join('') + fileHeader, 'utf8');
    const footerBuf = Buffer.from(fileFooter, 'utf8');
    const body = Buffer.concat([headerBuf, fileData, footerBuf]);

    const response = await new Promise((resolve, reject) => {
      const req = https.request({
        hostname: 'api.openai.com',
        path: '/v1/audio/transcriptions',
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': body.length,
        },
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => resolve({ status: res.statusCode, body: data }));
      });

      req.on('error', reject);
      req.write(body);
      req.end();
    });

    if (response.status !== 200) {
      let errorMsg = `Whisper API error (${response.status})`;
      try {
        const parsed = JSON.parse(response.body);
        if (parsed.error?.message) errorMsg = parsed.error.message;
      } catch {}
      return { success: false, error: errorMsg };
    }

    const result = JSON.parse(response.body);
    const segments = (result.segments || []).map((seg) => ({
      start: seg.start,
      end: seg.end,
      text: (seg.text || '').trim(),
    }));

    sendProgress('Done');
    return { success: true, segments };
  } catch (err) {
    return { success: false, error: err.message || String(err) };
  } finally {
    if (tempFile) {
      try { await fs.promises.unlink(tempFile); } catch {}
    }
  }
});

ipcMain.handle('remove-background', async (_evt, projectName, mediaRelativePath) => {
  const projectDir = path.join(projectsDir, projectName);
  const inputPath = path.join(projectDir, mediaRelativePath);

  // Verify input is inside the project directory
  const resolvedInput = path.resolve(inputPath);
  if (!resolvedInput.startsWith(path.resolve(projectDir) + path.sep)) {
    return { success: false, error: 'Invalid path' };
  }

  // Build output filename: <basename>_nobg.png with dedup counter
  const mediaDir = path.join(projectDir, 'media');
  const baseName = path.basename(inputPath, path.extname(inputPath));
  let outputName = `${baseName}_nobg.png`;
  let outputPath = path.join(mediaDir, outputName);
  let counter = 1;
  while (fs.existsSync(outputPath)) {
    outputName = `${baseName}_nobg_${counter}.png`;
    outputPath = path.join(mediaDir, outputName);
    counter++;
  }

  const augEnv = getAugmentedEnv();
  const sendProgress = (stage) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('rembg-progress', stage);
    }
  };

  // Helper: run a command with spawn, stream progress, support cancellation
  const runWithProgress = (cmd, args) => {
    return new Promise((resolve) => {
      const child = spawn(cmd, args, { env: augEnv, timeout: 120000 });
      _activeRembgProcess = child;
      let stderrBuf = '';

      child.stdout.on('data', (data) => {
        const text = data.toString();
        // Parse progress stage markers from the Python script
        const lines = text.split('\n');
        for (const line of lines) {
          const match = line.match(/^rembg:stage:(\w+)/);
          if (match) sendProgress(match[1]);
        }
      });

      child.stderr.on('data', (data) => {
        stderrBuf += data.toString();
      });

      child.on('close', (code, signal) => {
        _activeRembgProcess = null;
        if (signal === 'SIGTERM' || signal === 'SIGKILL') {
          resolve({ success: false, error: 'cancelled' });
        } else if (code !== 0) {
          resolve({ success: false, error: stderrBuf.trim() || `Process exited with code ${code}` });
        } else {
          resolve({ success: true, relativePath: 'media/' + outputName });
        }
      });

      child.on('error', (err) => {
        _activeRembgProcess = null;
        resolve({ success: false, error: err.code === 'ENOENT' ? 'not_installed' : (stderrBuf.trim() || err.message) });
      });
    });
  };

  // Find the Python interpreter that has rembg installed
  const pyWithRembg = findPythonWithRembg();

  if (pyWithRembg) {
    sendProgress('starting');
    return runWithProgress(pyWithRembg, ['-c', REMBG_FILE_REMOVE_SCRIPT, resolvedInput, outputPath]);
  }

  // Fallback: try bare rembg CLI (globally installed)
  sendProgress('starting');
  return runWithProgress('rembg', ['i', resolvedInput, outputPath]);
});

ipcMain.handle('cancel-remove-background', async () => {
  if (_activeRembgProcess) {
    _activeRembgProcess.kill('SIGTERM');
    _activeRembgProcess = null;
    return { success: true };
  }
  return { success: false };
});
