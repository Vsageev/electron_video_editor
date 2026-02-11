import { filePathToFileUrl } from './fileUrl';

export function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 100);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(2, '0')}`;
}

export function formatTimeShort(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function isVideoExt(ext: string): boolean {
  return ['.mp4', '.webm', '.mov', '.avi', '.mkv', '.ogg'].includes(ext);
}

export function isAudioExt(ext: string): boolean {
  return ['.mp3', '.wav', '.ogg', '.aac', '.flac'].includes(ext);
}

export function isComponentExt(ext: string): boolean {
  return ['.tsx', '.jsx'].includes(ext);
}

export function isImageExt(ext: string): boolean {
  return ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'].includes(ext);
}

async function getMediaDurationFromElement(
  filePath: string,
  type: string,
  timeoutMs: number
): Promise<number | null> {
  return await new Promise((resolve) => {
    let done = false;
    const el = document.createElement(type === 'video' ? 'video' : 'audio');
    el.preload = 'metadata';

    const finish = (value: number | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      el.removeAttribute('src');
      el.load();
      el.remove();
      resolve(value);
    };

    const tryResolve = () => {
      if (Number.isFinite(el.duration) && el.duration > 0) finish(el.duration);
    };

    el.onloadedmetadata = tryResolve;
    el.ondurationchange = tryResolve;
    el.onerror = () => finish(null);

    const timer = window.setTimeout(() => finish(null), timeoutMs);
    el.src = filePathToFileUrl(filePath);
  });
}

export async function getMediaDuration(filePath: string, type: string): Promise<number> {
  // 1) Try Chromium's native probing first.
  const fromElement = await getMediaDurationFromElement(filePath, type, 1500);
  if (fromElement && fromElement > 0) return fromElement;

  // 2) Fallback to the main process for containers/codecs Chromium can't probe.
  try {
    const fromMain = await window.api.getMediaDuration?.(filePath);
    if (typeof fromMain === 'number' && Number.isFinite(fromMain) && fromMain > 0) return fromMain;
  } catch {
    // ignore
  }

  return 0;
}
