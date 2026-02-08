const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn, spawnSync } = require('child_process');

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
    defaultPath: 'output.mp4',
    filters: [{ name: 'Video Files', extensions: ['mp4', 'webm'] }],
  });

  if (result.canceled) return null;
  return result.filePath;
});

// ---------------------------------------------------------------------------
// Video Export
// ---------------------------------------------------------------------------

let ffmpegProcess = null;

function getFfmpegPath() {
  // ffmpeg-static provides the path to the bundled binary
  try {
    return require('ffmpeg-static');
  } catch {
    return 'ffmpeg'; // fallback to PATH
  }
}

function fitSize(nw, nh, cw, ch) {
  if (!nw || !nh || !cw || !ch) return { w: 0, h: 0 };
  const aspect = nw / nh;
  return aspect > cw / ch
    ? { w: cw, h: cw / aspect }
    : { w: ch * aspect, h: ch };
}

function getVideoResolution(filePath) {
  const ffprobePath = getFfmpegPath().replace(/ffmpeg$/, 'ffprobe');
  const res = spawnSync(
    'ffprobe',
    ['-v', 'error', '-select_streams', 'v:0',
     '-show_entries', 'stream=width,height',
     '-print_format', 'json', filePath],
    {
      encoding: 'utf8', timeout: 5000,
      env: { ...process.env, PATH: ['/opt/homebrew/bin', '/usr/local/bin', process.env.PATH || ''].join(':') },
    }
  );
  if (res.error || res.status !== 0 || !res.stdout) return null;
  try {
    const data = JSON.parse(res.stdout);
    const s = data.streams?.[0];
    if (s?.width && s?.height) return { w: s.width, h: s.height };
  } catch {}
  return null;
}

ipcMain.handle('export-video', async (_evt, { outputPath, clips, width, height, fps }) => {
  if (ffmpegProcess) {
    return { success: false, error: 'Export already in progress' };
  }

  const ffmpegPath = getFfmpegPath();
  const videoClips = clips.filter((c) => c.type === 'video');

  if (videoClips.length === 0) {
    return { success: false, error: 'No video clips to export' };
  }

  // Calculate total timeline duration
  const totalDuration = Math.max(...clips.map((c) => c.startTime + c.duration));

  // Build ffmpeg arguments
  const args = [];

  // Base black canvas input
  args.push('-f', 'lavfi', '-i', `color=c=black:s=${width}x${height}:d=${totalDuration}:r=${fps}`);

  // Add each video clip as an input
  for (const clip of videoClips) {
    args.push('-i', clip.mediaPath);
  }

  // Build complex filter graph
  const filters = [];
  let lastLabel = '0:v';

  for (let i = 0; i < videoClips.length; i++) {
    const clip = videoClips[i];
    const inputIdx = i + 1; // 0 is the base canvas

    // Get natural resolution of this video
    const nat = getVideoResolution(clip.mediaPath);
    const nw = nat ? nat.w : width;
    const nh = nat ? nat.h : height;

    // Replicate preview fitSize logic: fit natural size into output resolution
    const base = fitSize(nw, nh, width, height);
    const scaledW = Math.round(base.w * clip.scale);
    const scaledH = Math.round(base.h * clip.scale);

    // Position: preview uses translate(-50% + x*baseW, -50% + y*baseH)
    // In ffmpeg overlay, top-left corner position:
    const overlayX = Math.round((width - scaledW) / 2 + clip.x * base.w);
    const overlayY = Math.round((height - scaledH) / 2 + clip.y * base.h);

    const clipDuration = clip.duration;
    const trimStartSec = clip.trimStart;

    const inLabel = `[${inputIdx}:v]`;
    const trimmedLabel = `v${i}trimmed`;
    const outLabel = `v${i}out`;

    // Trim, reset PTS, scale
    filters.push(
      `${inLabel}trim=start=${trimStartSec}:duration=${clipDuration},setpts=PTS-STARTPTS,scale=${scaledW}:${scaledH}[${trimmedLabel}]`
    );

    // Overlay onto the previous result
    const enableExpr = `between(t,${clip.startTime},${clip.startTime + clipDuration})`;
    filters.push(
      `[${lastLabel}][${trimmedLabel}]overlay=x=${overlayX}:y=${overlayY}:enable='${enableExpr}'[${outLabel}]`
    );

    lastLabel = outLabel;
  }

  const filterComplex = filters.join(';');

  args.push('-filter_complex', filterComplex);
  args.push('-map', `[${lastLabel}]`);

  // Audio: mix all audio from video clips
  if (videoClips.length === 1) {
    // Single clip: just map its audio stream directly
    args.push('-map', '1:a?');
  } else if (videoClips.length > 1) {
    // Multiple clips: add audio trim/delay filters and amix to the filter_complex
    const audioFilterParts = videoClips.map((clip, i) => {
      const inputIdx = i + 1;
      const delayMs = Math.round(clip.startTime * 1000);
      return `[${inputIdx}:a]atrim=start=${clip.trimStart}:duration=${clip.duration},asetpts=PTS-STARTPTS,adelay=${delayMs}|${delayMs}[a${i}]`;
    });
    const amixInputLabels = videoClips.map((_, i) => `[a${i}]`).join('');
    const amixStr = `${amixInputLabels}amix=inputs=${videoClips.length}:dropout_transition=0[aout]`;

    // Append audio filters to the existing filter_complex string
    const fcIdx = args.indexOf('-filter_complex');
    args[fcIdx + 1] = args[fcIdx + 1] + ';' + audioFilterParts.join(';') + ';' + amixStr;

    args.push('-map', '[aout]');
  }

  // Output settings
  args.push('-c:v', 'libx264', '-preset', 'medium', '-crf', '23');
  args.push('-c:a', 'aac', '-b:a', '192k');
  args.push('-pix_fmt', 'yuv420p');
  args.push('-y', outputPath);

  return new Promise((resolve) => {
    ffmpegProcess = spawn(ffmpegPath, args, {
      env: { ...process.env, PATH: ['/opt/homebrew/bin', '/usr/local/bin', process.env.PATH || ''].join(':') },
    });

    let stderrData = '';

    ffmpegProcess.stderr.on('data', (data) => {
      const text = data.toString();
      stderrData += text;

      // Parse progress: look for time=HH:MM:SS.ss
      const timeMatch = text.match(/time=(\d+):(\d+):(\d+)\.(\d+)/);
      if (timeMatch && totalDuration > 0) {
        const hours = parseInt(timeMatch[1]);
        const mins = parseInt(timeMatch[2]);
        const secs = parseInt(timeMatch[3]);
        const frac = parseInt(timeMatch[4]) / 100;
        const currentSec = hours * 3600 + mins * 60 + secs + frac;
        const percent = Math.min(100, Math.round((currentSec / totalDuration) * 100));
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('export-progress', { percent });
        }
      }
    });

    ffmpegProcess.on('close', (code) => {
      ffmpegProcess = null;
      if (code === 0) {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('export-progress', { percent: 100 });
        }
        resolve({ success: true });
      } else {
        // Extract last few lines of stderr for error message
        const lines = stderrData.trim().split('\n');
        const errMsg = lines.slice(-3).join('\n');
        resolve({ success: false, error: errMsg || `ffmpeg exited with code ${code}` });
      }
    });

    ffmpegProcess.on('error', (err) => {
      ffmpegProcess = null;
      resolve({ success: false, error: err.message });
    });
  });
});

ipcMain.handle('cancel-export', async () => {
  if (ffmpegProcess) {
    ffmpegProcess.kill('SIGTERM');
    ffmpegProcess = null;
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
