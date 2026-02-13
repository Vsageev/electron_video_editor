import { useState, useCallback, useEffect, useRef } from 'react';
import { useEditorStore } from '../store/editorStore';
import { isVideoExt, isAudioExt, isComponentExt, isImageExt, getMediaDuration, formatTime } from '../utils/formatTime';
import { loadComponent } from '../utils/componentLoader';
import ContextMenu from './ContextMenu';
import Tooltip from './Tooltip';
import type { MediaFile, ContextMenuItem } from '../types';

/* ---- Inline error banner for the sidebar ---- */
function SidebarError({ error, onDismiss }: { error: string; onDismiss: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(error);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  // Split first line (summary) from the rest (stack/details)
  const firstNewline = error.indexOf('\n');
  const summary = firstNewline > 0 ? error.slice(0, firstNewline) : error;
  const details = firstNewline > 0 ? error.slice(firstNewline + 1) : null;

  return (
    <div className="sidebar-error-banner">
      <div className="sidebar-error-header">
        <span className="sidebar-error-summary" onClick={() => details && setExpanded(!expanded)}>
          {summary}
        </span>
        <div className="sidebar-error-actions">
          {details && (
            <button
              className="sidebar-error-btn"
              onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
              title={expanded ? 'Collapse' : 'Expand'}
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s ease' }}>
                <path d="M2 4l3 3 3-3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )}
          <button className="sidebar-error-btn" onClick={handleCopy} title="Copy error">
            {copied ? (
              <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
                <path d="M2.5 6.5l2.5 2.5 5-5.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : (
              <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
                <rect x="3.5" y="3.5" width="6.5" height="7" rx="1" stroke="currentColor" strokeWidth="1.1" />
                <path d="M8.5 3.5V2.5a1 1 0 0 0-1-1h-5a1 1 0 0 0-1 1v5.5a1 1 0 0 0 1 1H3.5" stroke="currentColor" strokeWidth="1.1" />
              </svg>
            )}
          </button>
          <button className="sidebar-error-btn" onClick={(e) => { e.stopPropagation(); onDismiss(); }} title="Dismiss">
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>
      {expanded && details && (
        <pre className="sidebar-error-details">{details}</pre>
      )}
    </div>
  );
}

/**
 * Format a subprocess error for display: if it looks like a Python traceback,
 * extract the final error line as the summary and put the full traceback below.
 */
function formatSubprocessError(raw: string, fallbackSummary: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return fallbackSummary;

  const lines = trimmed.split('\n');
  if (lines.length <= 1) return trimmed;

  // Python tracebacks start with "Traceback" and have the real error on the last non-empty line
  const lastLine = lines[lines.length - 1].trim();
  if (trimmed.startsWith('Traceback') && lastLine) {
    return `${lastLine}\n${trimmed}`;
  }

  return trimmed;
}

/* ---- Rembg install error with copy ---- */
function RembgInstallError({ error, log, logRef, onRetry }: {
  error: string | null;
  log: string | null;
  logRef: React.RefObject<HTMLPreElement>;
  onRetry: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const fullText = [error, log].filter(Boolean).join('\n\n');

  const handleCopy = () => {
    navigator.clipboard.writeText(fullText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="rembg-install-error-details">
      <div className="rembg-install-error-header">
        <div className="rembg-install-error-msg">{error}</div>
        <button className="sidebar-error-btn" onClick={handleCopy} title="Copy error">
          {copied ? (
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
              <path d="M2.5 6.5l2.5 2.5 5-5.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : (
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
              <rect x="3.5" y="3.5" width="6.5" height="7" rx="1" stroke="currentColor" strokeWidth="1.1" />
              <path d="M8.5 3.5V2.5a1 1 0 0 0-1-1h-5a1 1 0 0 0-1 1v5.5a1 1 0 0 0 1 1H3.5" stroke="currentColor" strokeWidth="1.1" />
            </svg>
          )}
        </button>
      </div>
      {log && (
        <pre ref={logRef} className="rembg-install-log">{log}</pre>
      )}
      <button className="rembg-install-btn" onClick={onRetry}>Retry</button>
    </div>
  );
}

const METADATA_HINTS: Record<string, string> = {
  video: `# Scene Description

## Shot Details
- **Location**:
- **Camera**:
- **Resolution**:

## Timestamps
- 00:00 – 00:05  Establishing shot
- 00:05 – 00:12  Subject enters frame

## Notes
Add any production notes, scene context, or editing instructions here.

## Tags
#raw #footage`,
  audio: `# Audio Notes

## Track Info
- **Artist / Source**:
- **BPM**:
- **Key**:

## Timestamps
- 00:00 – 00:30  Intro / build-up
- 00:30 – 01:15  Main section

## Usage Notes
Describe where this audio fits in the project.

## Tags
#music #sfx`,
  component: `# Component Notes

## Description
What this component renders.

## Props Used
- currentTime, duration, progress, width, height

## Tags
#component #overlay`,
  image: `# Image Notes

## Description
What this image depicts.

## Usage
Where this image is used in the project.

## Tags
#image #still`,
};

export default function MediaSidebar() {
  const {
    mediaFiles,
    selectedMediaIndex,
    addMediaFiles,
    removeMediaFile,
    selectMedia,
    addClip,
    setPreviewMedia,
    mediaMetadata,
    mediaMetadataLoading,
    loadMediaMetadata,
    saveMediaMetadata,
    setDraggingMediaIndex,
  } = useEditorStore();

  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    items: ContextMenuItem[];
  } | null>(null);

  const [metadataOpen, setMetadataOpen] = useState(false);
  const [editingMetadata, setEditingMetadata] = useState(false);
  const [draftMetadata, setDraftMetadata] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const logRef = useRef<HTMLPreElement>(null);

  const currentProject = useEditorStore((s) => s.currentProject);
  const projectDir = useEditorStore((s) => s.projectDir);

  const selectedMedia = selectedMediaIndex !== null ? mediaFiles[selectedMediaIndex] : null;
  const metadataContent = selectedMedia ? (mediaMetadata[selectedMedia.path] ?? '') : '';

  // Load metadata when selection changes
  useEffect(() => {
    if (selectedMedia) {
      loadMediaMetadata(selectedMedia.path);
    }
    setEditingMetadata(false);
  }, [selectedMedia?.path, loadMediaMetadata]);

  const handleStartEdit = useCallback(() => {
    setDraftMetadata(metadataContent);
    setEditingMetadata(true);
    setTimeout(() => textareaRef.current?.focus(), 0);
  }, [metadataContent]);

  const handleSaveMetadata = useCallback(() => {
    if (selectedMedia) {
      saveMediaMetadata(selectedMedia.path, draftMetadata);
    }
    setEditingMetadata(false);
  }, [selectedMedia, draftMetadata, saveMediaMetadata]);

  const handleCancelEdit = useCallback(() => {
    setEditingMetadata(false);
  }, []);

  const [importError, setImportError] = useState<string | null>(null);
  const [builtinComponents, setBuiltinComponents] = useState<{ name: string; fileName: string }[]>([]);
  const [showBuiltins, setShowBuiltins] = useState(false);
  const [removingBgPath, setRemovingBgPath] = useState<string | null>(null);
  const [rembgStage, setRembgStage] = useState<string | null>(null);
  const [rembgElapsed, setRembgElapsed] = useState(0);
  const rembgTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [rembgInstallState, setRembgInstallState] = useState<'idle' | 'installing' | 'success' | 'error'>('idle');
  const [rembgInstallError, setRembgInstallError] = useState<string | null>(null);
  const [rembgInstallLog, setRembgInstallLog] = useState<string | null>(null);
  const [showRembgBanner, setShowRembgBanner] = useState(false);
  // Media to process after install completes
  const [pendingBgRemoval, setPendingBgRemoval] = useState<MediaFile | null>(null);
  // Tracks whether we just installed — prevents showing install banner again if post-install removal fails
  const rembgJustInstalled = useRef(false);

  // Load built-in component list
  useEffect(() => {
    window.api.listBuiltinComponents().then(setBuiltinComponents).catch(() => {});
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    if (!showBuiltins) return;
    const handler = () => setShowBuiltins(false);
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [showBuiltins]);

  const handleImport = useCallback(async () => {
    const files = await window.api.openFileDialog();
    if (!files.length) return;
    setImportError(null);

    const newMediaFiles: MediaFile[] = [];
    for (const file of files) {
      const type: MediaFile['type'] | null = isComponentExt(file.ext)
        ? 'component'
        : isVideoExt(file.ext)
          ? 'video'
          : isAudioExt(file.ext)
            ? 'audio'
            : isImageExt(file.ext)
              ? 'image'
              : null;

      if (!type) {
        setImportError(`Unsupported file type: ${file.name}`);
        continue;
      }

      let finalPath = file.path;
      let finalName = file.name;
      let bundlePath: string | undefined;

      // Copy media into project folder if a project is active
      if (currentProject) {
        const copyResult = await window.api.copyMediaToProject(currentProject, file.path);
        if (copyResult.success && copyResult.relativePath) {
          finalPath = projectDir + '/' + copyResult.relativePath;
          finalName = copyResult.relativePath.split('/').pop() || file.name;
        }
      }

      // Bundle component files
      if (type === 'component') {
        if (!currentProject) {
          setImportError('Components require an active project. Create or open a project first.');
          continue;
        }
        const bundleResult = await window.api.bundleComponent(currentProject, file.path);
        if (!bundleResult.success) {
          setImportError(`Failed to bundle ${file.name}: ${bundleResult.error}`);
          // Clean up copied source file on failure — it was already copied but can't be used
          continue;
        }
        bundlePath = projectDir + '/' + bundleResult.bundlePath;
      }

      const duration = (type === 'component' || type === 'image')
        ? 5
        : await getMediaDuration(file.path, type);

      // Extract propDefinitions from component bundles
      let propDefinitions;
      if (type === 'component' && bundlePath) {
        try {
          const entry = await loadComponent(bundlePath);
          propDefinitions = entry.propDefinitions;
        } catch { /* ignore — component will still work without propDefinitions */ }
      }

      newMediaFiles.push({
        path: finalPath,
        name: finalName,
        ext: file.ext,
        type,
        duration,
        ...(bundlePath ? { bundlePath } : {}),
        ...(propDefinitions ? { propDefinitions } : {}),
      });
    }
    if (newMediaFiles.length > 0) {
      addMediaFiles(newMediaFiles);
    }
  }, [addMediaFiles, currentProject, projectDir]);

  const handleAddBuiltin = useCallback(async (builtin: { name: string; fileName: string }) => {
    if (!currentProject) {
      setImportError('Components require an active project.');
      return;
    }
    setImportError(null);
    const result = await window.api.addBuiltinComponent(currentProject, builtin.fileName);
    if (!result.success) {
      setImportError(`Failed to add ${builtin.name}: ${result.error}`);
      return;
    }
    const fullBundlePath = projectDir + '/' + result.bundlePath;
    // Extract propDefinitions from bundle
    let propDefinitions;
    try {
      const entry = await loadComponent(fullBundlePath);
      propDefinitions = entry.propDefinitions;
    } catch { /* ignore */ }

    addMediaFiles([{
      path: projectDir + '/' + result.sourcePath,
      name: builtin.name,
      ext: '.' + builtin.fileName.split('.').pop(),
      type: 'component',
      duration: 5,
      bundlePath: fullBundlePath,
      ...(propDefinitions ? { propDefinitions } : {}),
    }]);
    setShowBuiltins(false);
  }, [addMediaFiles, currentProject, projectDir]);

  const handleClick = useCallback(
    (index: number) => {
      selectMedia(index);
      const media = mediaFiles[index];
      setPreviewMedia(media.path, media.type);
    },
    [selectMedia, setPreviewMedia, mediaFiles]
  );

  const handleDoubleClick = useCallback(
    (media: MediaFile) => {
      addClip(media);
    },
    [addClip]
  );

  const doRemoveBackground = useCallback(async (media: MediaFile) => {
    if (!currentProject || !projectDir) return;
    const prefix = projectDir + '/';
    const relativePath = media.path.startsWith(prefix)
      ? media.path.slice(prefix.length)
      : media.path;
    setRemovingBgPath(media.path);
    setRembgStage(null);
    setRembgElapsed(0);
    setImportError(null);
    // Start elapsed timer
    if (rembgTimerRef.current) clearInterval(rembgTimerRef.current);
    const startTime = Date.now();
    rembgTimerRef.current = setInterval(() => {
      setRembgElapsed(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);
    try {
      const result = await window.api.removeBackground(currentProject, relativePath);
      if (!result.success) {
        if (result.error === 'cancelled') return;
        if (result.error === 'not_installed') {
          if (rembgJustInstalled.current) {
            // Install reported success but rembg still not working — show error, not install prompt
            rembgJustInstalled.current = false;
            setShowRembgBanner(false);
            setImportError('rembg installed but still not working. Try restarting the app, or install manually: python3 -m pip install rembg[cli]');
            return;
          }
          setPendingBgRemoval(media);
          setRembgInstallState('idle');
          setRembgInstallError(null);
          setShowRembgBanner(true);
          return;
        }
        setImportError(formatSubprocessError(result.error || '', 'Background removal failed'));
        return;
      }
      rembgJustInstalled.current = false;
      setShowRembgBanner(false);
      const fullPath = projectDir + '/' + result.relativePath;
      const fileName = result.relativePath!.split('/').pop() || 'output.png';
      addMediaFiles([{
        path: fullPath,
        name: fileName,
        ext: '.png',
        type: 'image',
        duration: 5,
      }]);
    } catch (err: any) {
      setImportError(formatSubprocessError(err.message || '', 'Background removal failed'));
    } finally {
      if (rembgTimerRef.current) { clearInterval(rembgTimerRef.current); rembgTimerRef.current = null; }
      setRemovingBgPath(null);
      setRembgStage(null);
      setRembgElapsed(0);
    }
  }, [currentProject, projectDir, addMediaFiles]);

  // Subscribe to streaming install logs
  useEffect(() => {
    if (rembgInstallState !== 'installing') return;
    const unsub = window.api.onRembgInstallLog((log: string) => {
      setRembgInstallLog(log);
    });
    return unsub;
  }, [rembgInstallState]);

  // Subscribe to rembg progress stage events
  useEffect(() => {
    if (!removingBgPath) return;
    const unsub = window.api.onRembgProgress((stage: string) => {
      setRembgStage(stage);
    });
    return unsub;
  }, [removingBgPath]);

  // Clean up timer on unmount
  useEffect(() => {
    return () => { if (rembgTimerRef.current) clearInterval(rembgTimerRef.current); };
  }, []);

  const handleCancelRembg = useCallback(async () => {
    await window.api.cancelRemoveBackground();
    if (rembgTimerRef.current) { clearInterval(rembgTimerRef.current); rembgTimerRef.current = null; }
    setRemovingBgPath(null);
    setRembgStage(null);
    setRembgElapsed(0);
  }, []);

  // Auto-scroll log to bottom
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [rembgInstallLog]);

  const handleInstallRembg = useCallback(async () => {
    setRembgInstallState('installing');
    setRembgInstallError(null);
    setRembgInstallLog(null);
    try {
      // Check if python is available first
      const check = await window.api.checkRembg();
      if (!check.hasPython) {
        setRembgInstallState('error');
        setRembgInstallError('Python 3 not found. Install it from python.org/downloads then try again.');
        return;
      }
      if (check.hasRembg) {
        // Already installed (maybe PATH was stale on first check)
        setRembgInstallState('success');
        rembgJustInstalled.current = true;
        if (pendingBgRemoval) {
          const media = pendingBgRemoval;
          setPendingBgRemoval(null);
          doRemoveBackground(media);
        } else {
          setTimeout(() => setShowRembgBanner(false), 2000);
        }
        return;
      }
      const result = await window.api.installRembg();
      if (!result.success) {
        setRembgInstallState('error');
        setRembgInstallError(result.error || 'Installation failed');
        if (result.log) setRembgInstallLog(result.log);
        return;
      }
      setRembgInstallState('success');
      setRembgInstallLog(null);
      rembgJustInstalled.current = true;
      // Auto-run the pending background removal
      if (pendingBgRemoval) {
        const media = pendingBgRemoval;
        setPendingBgRemoval(null);
        doRemoveBackground(media);
      } else {
        setTimeout(() => setShowRembgBanner(false), 2000);
      }
    } catch (err: any) {
      setRembgInstallState('error');
      setRembgInstallError(err.message || 'Installation failed');
    }
  }, [pendingBgRemoval, doRemoveBackground]);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, media: MediaFile, index: number) => {
      e.preventDefault();
      const items: ContextMenuItem[] = [
        { label: 'Add to Timeline', action: () => addClip(media) },
      ];
      if ((media.type === 'video' || media.type === 'audio') && currentProject) {
        items.push({
          label: 'Generate Subtitles',
          action: () => {
            // Find first clip on timeline using this media and generate subtitles for it
            const state = useEditorStore.getState();
            const clip = state.timelineClips.find((c) => c.mediaPath === media.path);
            if (clip) {
              state.generateSubtitles(clip.id);
            } else {
              // Add clip first, then generate
              state.addClip(media);
              const updated = useEditorStore.getState();
              const newClip = updated.timelineClips.find((c) => c.mediaPath === media.path);
              if (newClip) updated.generateSubtitles(newClip.id);
            }
          },
        });
      }
      if (media.type === 'image' && currentProject) {
        items.push({
          label: 'Remove Background',
          action: () => doRemoveBackground(media),
        });
      }
      items.push({ divider: true });
      items.push({
        label: 'Remove from Media',
        danger: true,
        action: () => removeMediaFile(index),
      });
      setContextMenu({
        x: e.clientX,
        y: e.clientY,
        items,
      });
    },
    [addClip, removeMediaFile, currentProject, doRemoveBackground]
  );

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <span className="sidebar-label">MEDIA</span>
        <div className="sidebar-header-actions">
          {builtinComponents.length > 0 && (
            <div className="builtin-dropdown-wrapper">
              <Tooltip label="Add built-in component">
                <button
                  className="btn-icon"
                  onClick={(e) => { e.stopPropagation(); setShowBuiltins((v) => !v); }}
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <path d="M5 3L2 8l3 5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M11 3l3 5-3 5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              </Tooltip>
              {showBuiltins && (
                <div className="builtin-dropdown">
                  {builtinComponents.map((b) => (
                    <button
                      key={b.fileName}
                      className="builtin-dropdown-item"
                      onClick={() => handleAddBuiltin(b)}
                    >
                      {b.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <Tooltip label="Import media">
            <button className="btn-icon" onClick={handleImport}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </Tooltip>
        </div>
      </div>
      {importError && (
        <SidebarError error={importError} onDismiss={() => setImportError(null)} />
      )}
      {showRembgBanner && (
        <div className="rembg-install-banner">
          <div className="rembg-install-header">
            <div>
              <div className="rembg-install-title">Background removal requires rembg</div>
              <div className="rembg-install-subtitle">One-time install via pip (Python package manager)</div>
            </div>
            <button className="rembg-install-close" onClick={() => { setShowRembgBanner(false); setPendingBgRemoval(null); setRembgInstallLog(null); setRembgInstallState('idle'); }}>
              <svg width="10" height="10" viewBox="0 0 10 10"><path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
            </button>
          </div>
          {rembgInstallState === 'idle' && (
            <button className="rembg-install-btn" onClick={handleInstallRembg}>
              Install rembg
            </button>
          )}
          {rembgInstallState === 'installing' && (
            <>
              <div className="rembg-install-progress">
                <span className="media-item-processing">Installing... this may take a minute</span>
              </div>
              {rembgInstallLog && (
                <pre ref={logRef} className="rembg-install-log">{rembgInstallLog}</pre>
              )}
            </>
          )}
          {rembgInstallState === 'error' && (
            <RembgInstallError
              error={rembgInstallError}
              log={rembgInstallLog}
              logRef={logRef}
              onRetry={handleInstallRembg}
            />
          )}
          {rembgInstallState === 'success' && (
            <div className="rembg-install-progress">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ marginRight: 6, flexShrink: 0 }}>
                <circle cx="7" cy="7" r="6" stroke="var(--green)" strokeWidth="1.3" />
                <path d="M4 7l2 2 4-4" stroke="var(--green)" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span style={{ color: 'var(--green)' }}>
                {pendingBgRemoval ? 'Installed! Removing background...' : 'rembg installed successfully'}
              </span>
            </div>
          )}
        </div>
      )}
      <div className="media-list">
        {mediaFiles.length === 0 ? (
          <div className="media-empty">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
              <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.5" />
              <path d="M10 9l5 3-5 3V9z" fill="currentColor" opacity="0.5" />
            </svg>
            <p>Import media to get started</p>
            <button className="btn-primary btn-sm" onClick={handleImport}>
              Import Files
            </button>
          </div>
        ) : (
          mediaFiles.map((media, idx) => (
            <div
              key={media.path}
              className={`media-item${idx === selectedMediaIndex ? ' selected' : ''}`}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData('application/json', JSON.stringify({ mediaIndex: idx }));
                e.dataTransfer.effectAllowed = 'copy';
                setDraggingMediaIndex(idx);
              }}
              onDragEnd={() => setDraggingMediaIndex(null)}
              onClick={() => handleClick(idx)}
              onDoubleClick={() => handleDoubleClick(media)}
              onContextMenu={(e) => handleContextMenu(e, media, idx)}
            >
              <div className={`media-item-icon${media.type === 'audio' ? ' audio' : media.type === 'component' ? ' component' : media.type === 'image' ? ' image' : ''}`}>
                {media.type === 'video' ? (
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <rect x="2" y="4" width="12" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
                    <path d="M7 7l3 1.5-3 1.5V7z" fill="currentColor" opacity="0.6" />
                  </svg>
                ) : media.type === 'component' ? (
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <path d="M5 3L2 8l3 5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M11 3l3 5-3 5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M9 2L7 14" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                  </svg>
                ) : media.type === 'image' ? (
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <rect x="2" y="3" width="12" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
                    <circle cx="5.5" cy="6.5" r="1.5" fill="currentColor" opacity="0.6" />
                    <path d="M2 11l3-3 2 2 3-4 4 5H2z" fill="currentColor" opacity="0.4" />
                  </svg>
                ) : (
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <rect x="6" y="2" width="4" height="7" rx="2" stroke="currentColor" strokeWidth="1.2" />
                    <path d="M5 8a3 3 0 006 0" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                    <path d="M8 11v3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                  </svg>
                )}
              </div>
              <div className="media-item-info">
                <div className="media-item-name">{media.name}</div>
                <div className="media-item-meta">
                  {removingBgPath === media.path ? (
                    <span className="media-item-processing">
                      {rembgStage === 'processing' ? 'Processing' : rembgStage === 'importing' ? 'Loading model' : rembgStage === 'writing' ? 'Saving' : 'Removing background'}
                      {rembgElapsed > 0 && <span className="rembg-elapsed"> ({rembgElapsed}s)</span>}
                      <button className="rembg-cancel-btn" onClick={(e) => { e.stopPropagation(); handleCancelRembg(); }} title="Cancel">✕</button>
                    </span>
                  ) : (
                    formatTime(media.duration)
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
      {/* Metadata Panel */}
      {selectedMedia && (
        <div className="media-metadata-section">
          <button
            className="media-metadata-toggle"
            onClick={() => setMetadataOpen((v) => !v)}
          >
            <svg
              width="10"
              height="10"
              viewBox="0 0 10 10"
              fill="none"
              className={`media-metadata-chevron${metadataOpen ? ' open' : ''}`}
            >
              <path d="M3 1.5L6.5 5L3 8.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="media-metadata-label">
              METADATA
              <span className="media-metadata-filename">{selectedMedia.name}</span>
            </span>
            {metadataContent && (
              <span className="media-metadata-dot" />
            )}
          </button>
          {metadataOpen && (
            <div className="media-metadata-body">
              {mediaMetadataLoading ? (
                <div className="media-metadata-loading">Loading...</div>
              ) : editingMetadata ? (
                <>
                  <textarea
                    ref={textareaRef}
                    className="media-metadata-textarea"
                    value={draftMetadata}
                    onChange={(e) => setDraftMetadata(e.target.value)}
                    placeholder={METADATA_HINTS[selectedMedia.type] || ''}
                    spellCheck={false}
                  />
                  <div className="media-metadata-actions">
                    <button className="media-metadata-btn save" onClick={handleSaveMetadata}>
                      Save
                    </button>
                    <button className="media-metadata-btn cancel" onClick={handleCancelEdit}>
                      Cancel
                    </button>
                  </div>
                </>
              ) : metadataContent ? (
                <div className="media-metadata-preview" onClick={handleStartEdit}>
                  <pre className="media-metadata-content">{metadataContent}</pre>
                  <span className="media-metadata-edit-hint">Click to edit</span>
                </div>
              ) : (
                <div className="media-metadata-empty" onClick={handleStartEdit}>
                  <pre className="media-metadata-hint">{METADATA_HINTS[selectedMedia.type] || ''}</pre>
                  <span className="media-metadata-edit-hint">Click to add metadata</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenu.items}
          onClose={() => setContextMenu(null)}
        />
      )}
    </aside>
  );
}
