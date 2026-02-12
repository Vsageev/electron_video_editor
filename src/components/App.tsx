import { useEffect, useCallback, useRef, useState, useMemo } from 'react';
import { useEditorStore } from '../store/editorStore';
import { exportToVideo } from '../utils/canvasExport';
import MediaSidebar from './MediaSidebar';
import PreviewPanel from './PreviewPanel';
import Timeline from './Timeline';
import PropertiesSidebar from './PropertiesSidebar';
import ApiKeysModal from './ApiKeysModal';
import ProjectPicker from './ProjectPicker';
import Tooltip from './Tooltip';

/* ---- Error Banner (expandable) ---- */
function ErrorBanner({ error, onDismiss }: { error: string; onDismiss: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(error);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  // Split first line (summary) from the rest (stack/details)
  const firstNewline = error.indexOf('\n');
  const summary = firstNewline > 0 ? error.slice(0, firstNewline) : error;
  const hasDetails = firstNewline > 0;

  return (
    <div className="error-banner">
      <div className="error-banner-header" onClick={() => hasDetails && setExpanded(!expanded)}>
        <svg className="error-banner-icon" width="14" height="14" viewBox="0 0 16 16" fill="none">
          <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.2" />
          <path d="M8 5v3.5M8 10.5v.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
        <span className="error-banner-summary">{summary}</span>
        {hasDetails && (
          <button
            className="error-banner-expand"
            onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
            aria-label={expanded ? 'Collapse' : 'Expand'}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s ease' }}>
              <path d="M2 4l3 3 3-3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
        <button className="error-banner-copy" onClick={(e) => { e.stopPropagation(); handleCopy(); }} title="Copy full error" aria-label="Copy error text">
          {copied ? (
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M2.5 6.5l2.5 2.5 5-5.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <rect x="3.5" y="3.5" width="6.5" height="7" rx="1" stroke="currentColor" strokeWidth="1.1" />
              <path d="M8.5 3.5V2.5a1 1 0 0 0-1-1h-5a1 1 0 0 0-1 1v5.5a1 1 0 0 0 1 1H3.5" stroke="currentColor" strokeWidth="1.1" />
            </svg>
          )}
        </button>
        <button className="error-banner-dismiss" onClick={(e) => { e.stopPropagation(); onDismiss(); }} title="Dismiss" aria-label="Dismiss error">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      {expanded && hasDetails && (
        <div className="error-banner-details">
          <pre className="error-banner-stack">{error}</pre>
        </div>
      )}
    </div>
  );
}

const BASE_DIMS = [2160, 1080, 720, 480];
const BASE_LABELS = ['4K', '1080p', '720p', '480p'];

function roundEven(n: number) {
  return Math.round(n / 2) * 2;
}

function buildResolutionPresets(w: number, h: number) {
  const ratio = w / h;
  return BASE_DIMS.map((dim, i) => {
    let pw: number;
    let ph: number;
    if (ratio >= 1) {
      pw = roundEven(dim * ratio);
      ph = dim;
    } else {
      pw = dim;
      ph = roundEven(dim / ratio);
    }
    return { label: `${BASE_LABELS[i]} (${pw}×${ph})`, width: pw, height: ph };
  });
}

function SubtitleProgressBanner() {
  const isGenerating = useEditorStore((s) => s.isGeneratingSubtitles);
  const progress = useEditorStore((s) => s.subtitleProgress);
  if (!isGenerating) return null;
  return (
    <div className="subtitle-progress-banner">
      <span className="subtitle-progress-spinner" />
      <span>Generating subtitles: {progress || 'Starting...'}</span>
    </div>
  );
}

const FPS_PRESETS = [24, 30, 60];

const QUALITY_PRESETS = [
  { label: 'Low (4 Mbps)', bitrate: 4_000_000 },
  { label: 'Medium (8 Mbps)', bitrate: 8_000_000 },
  { label: 'High (16 Mbps)', bitrate: 16_000_000 },
  { label: 'Ultra (32 Mbps)', bitrate: 32_000_000 },
];

export default function App() {
  const { removeSelectedClips } = useEditorStore();
  const timelineClips = useEditorStore((s) => s.timelineClips);
  const isExporting = useEditorStore((s) => s.isExporting);
  const exportProgress = useEditorStore((s) => s.exportProgress);
  const setIsExporting = useEditorStore((s) => s.setIsExporting);
  const setExportProgress = useEditorStore((s) => s.setExportProgress);
  const showExportSettings = useEditorStore((s) => s.showExportSettings);
  const setShowExportSettings = useEditorStore((s) => s.setShowExportSettings);
  const exportSettings = useEditorStore((s) => s.exportSettings);
  const setExportSettings = useEditorStore((s) => s.setExportSettings);
  const setShowSettings = useEditorStore((s) => s.setShowSettings);
  const currentProject = useEditorStore((s) => s.currentProject);
  const isSaving = useEditorStore((s) => s.isSaving);
  const projectError = useEditorStore((s) => s.projectError);
  const projectWarnings = useEditorStore((s) => s.projectWarnings);
  const setProjectError = useEditorStore((s) => s.setProjectError);
  const clearProjectWarnings = useEditorStore((s) => s.clearProjectWarnings);
  const openProject = useEditorStore((s) => s.openProject);
  const createProject = useEditorStore((s) => s.createProject);
  const resolutionPresets = useMemo(
    () => buildResolutionPresets(exportSettings.width, exportSettings.height),
    [exportSettings.width, exportSettings.height],
  );
  const abortRef = useRef<AbortController | null>(null);
  const [showProjectPicker, setShowProjectPicker] = useState(false);
  const [projectLoading, setProjectLoading] = useState(true);

  // Auto-load last project on startup
  useEffect(() => {
    (async () => {
      try {
        const last = await window.api.getLastProject();
        if (last) {
          await openProject(last);
        } else {
          // Auto-create a default project if none exist
          const projects = await window.api.listProjects();
          if (projects.length === 0) {
            await createProject('My Project');
          } else {
            setShowProjectPicker(true);
          }
        }
      } catch {
        setShowProjectPicker(true);
      } finally {
        setProjectLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      const tag = el.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable) return;

      if (e.code === 'Delete' || e.code === 'Backspace') {
        const { selectedClipIds } = useEditorStore.getState();
        if (selectedClipIds.length > 0) {
          removeSelectedClips();
        }
        return;
      }

      const state = useEditorStore.getState();
      const fps = state.exportSettings?.fps || 30;
      const frameTime = 1 / fps;

      if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
        e.preventDefault();
        const delta = e.shiftKey ? 1 : frameTime;
        const direction = e.code === 'ArrowLeft' ? -1 : 1;
        const newTime = Math.min(Math.max(state.currentTime + delta * direction, 0), state.duration);
        state.setCurrentTime(newTime);
      } else if (e.code === 'Space') {
        e.preventDefault();
        state.setIsPlaying(!state.isPlaying);
      } else if (e.code === 'Home') {
        e.preventDefault();
        state.setCurrentTime(0);
      } else if (e.code === 'End') {
        e.preventDefault();
        state.setCurrentTime(state.duration);
      } else if (e.code === 'KeyS' && !e.metaKey && !e.ctrlKey) {
        // Split selected clip at playhead
        state.splitClipAtPlayhead();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [removeSelectedClips]);

  const handleExport = useCallback(async () => {
    if (timelineClips.length === 0) return;

    const { width, height, fps, bitrate } = useEditorStore.getState().exportSettings;

    const outputPath = await window.api.exportDialog();
    if (!outputPath) return;

    setIsExporting(true);
    setExportProgress(0);
    setShowExportSettings(false);

    const abort = new AbortController();
    abortRef.current = abort;

    try {
      const blob = await exportToVideo(
        timelineClips,
        width,
        height,
        fps,
        (percent) => setExportProgress(percent),
        abort.signal,
        bitrate,
        useEditorStore.getState().mediaFiles,
        useEditorStore.getState().tracks,
      );

      if (!abort.signal.aborted) {
        const arrayBuffer = await blob.arrayBuffer();
        const result = await window.api.saveBlob(outputPath, arrayBuffer);
        if (!result.success) {
          alert('Export failed: ' + (result.error || 'Unknown error'));
        }
      }
    } catch (err: any) {
      if (!abort.signal.aborted) {
        alert('Export failed: ' + (err.message || 'Unknown error'));
      }
    } finally {
      abortRef.current = null;
      setIsExporting(false);
    }
  }, [timelineClips, setIsExporting, setExportProgress, setShowExportSettings]);

  const handleCancelExport = useCallback(() => {
    abortRef.current?.abort();
    setIsExporting(false);
  }, [setIsExporting]);

  const handleResolutionChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const preset = resolutionPresets[Number(e.target.value)];
      setExportSettings({ width: preset.width, height: preset.height });
    },
    [setExportSettings, resolutionPresets],
  );

  const selectedResIdx = resolutionPresets.findIndex(
    (p) => p.width === exportSettings.width && p.height === exportSettings.height,
  );

  if (projectLoading) {
    return (
      <div className="project-loading">
        <div className="project-loading-text">Loading project...</div>
      </div>
    );
  }

  if (!currentProject && showProjectPicker) {
    return <ProjectPicker onClose={() => setShowProjectPicker(false)} />;
  }

  return (
    <>
      <div className="titlebar">
        <div className="titlebar-spacer" />
        <Tooltip label="Switch project" pos="bottom">
          <button
            className="titlebar-project-name"
            onClick={() => setShowProjectPicker(true)}
          >
            <svg className="titlebar-project-folder-icon" width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M2 4a1.5 1.5 0 011.5-1.5h3.25l1.5 1.5H12.5A1.5 1.5 0 0114 5.5v6a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 012 11.5V4z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
            </svg>
            <span>{currentProject || 'No Project'}</span>
            {isSaving && <span className="titlebar-save-indicator" />}
            <svg className="titlebar-project-chevron" width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M3 4l2 2 2-2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </Tooltip>
        <span className="titlebar-title">Video Editor</span>
        <div className="titlebar-actions">
          <Tooltip label="Settings" pos="bottom">
            <button
              className="btn-icon titlebar-settings-btn"
              onClick={() => setShowSettings(true)}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M6.5 1.75a.75.75 0 011.5 0v.3a5.5 5.5 0 011.68.7l.21-.22a.75.75 0 011.06 1.06l-.21.22a5.5 5.5 0 01.7 1.68h.3a.75.75 0 010 1.5h-.3a5.5 5.5 0 01-.7 1.68l.22.21a.75.75 0 01-1.06 1.06l-.22-.21a5.5 5.5 0 01-1.68.7v.3a.75.75 0 01-1.5 0v-.3a5.5 5.5 0 01-1.68-.7l-.21.22a.75.75 0 01-1.06-1.06l.21-.22a5.5 5.5 0 01-.7-1.68h-.3a.75.75 0 010-1.5h.3a5.5 5.5 0 01.7-1.68l-.22-.21A.75.75 0 014.6 2.53l.22.21a5.5 5.5 0 011.68-.7v-.3zM8 10a2 2 0 100-4 2 2 0 000 4z" fill="currentColor"/>
              </svg>
            </button>
          </Tooltip>
          <button
            className="btn-export"
            onClick={() => setShowExportSettings(true)}
            disabled={timelineClips.length === 0 || isExporting}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M8 1v9M4 6l4-4 4 4M2 11v2a2 2 0 002 2h8a2 2 0 002-2v-2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Export
          </button>
        </div>
      </div>

      {projectError && (
        <ErrorBanner error={projectError} onDismiss={() => setProjectError(null)} />
      )}

      {projectWarnings.length > 0 && (
        <div className="project-banner project-banner-warning">
          <div className="project-banner-content">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M8 2L1.5 13h13L8 2z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
              <path d="M8 6.5v3M8 11.5v.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
            <span>{projectWarnings.join('; ')}</span>
          </div>
          <button className="project-banner-copy" onClick={() => { navigator.clipboard.writeText(projectWarnings.join('; ')); }} title="Copy warning" aria-label="Copy warning text">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <rect x="3.5" y="3.5" width="6.5" height="7" rx="1" stroke="currentColor" strokeWidth="1.1" />
              <path d="M8.5 3.5V2.5a1 1 0 0 0-1-1h-5a1 1 0 0 0-1 1v5.5a1 1 0 0 0 1 1H3.5" stroke="currentColor" strokeWidth="1.1" />
            </svg>
          </button>
          <button className="project-banner-dismiss" onClick={clearProjectWarnings} title="Dismiss" aria-label="Dismiss warnings">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      )}

      {showProjectPicker && currentProject && (
        <ProjectPicker onClose={() => setShowProjectPicker(false)} />
      )}

      {showExportSettings && (
        <div className="export-overlay" onClick={() => setShowExportSettings(false)}>
          <div className="export-modal export-settings-modal" onClick={(e) => e.stopPropagation()}>
            <div className="export-modal-title">Export Settings</div>

            <div className="export-settings-row">
              <label className="export-settings-label">Resolution</label>
              <select
                className="export-settings-select"
                value={selectedResIdx >= 0 ? selectedResIdx : 1}
                onChange={handleResolutionChange}
              >
                {resolutionPresets.map((p, i) => (
                  <option key={i} value={i}>{p.label}</option>
                ))}
              </select>
            </div>

            <div className="export-settings-row">
              <label className="export-settings-label">Frame Rate</label>
              <select
                className="export-settings-select"
                value={exportSettings.fps}
                onChange={(e) => setExportSettings({ fps: Number(e.target.value) })}
              >
                {FPS_PRESETS.map((f) => (
                  <option key={f} value={f}>{f} fps</option>
                ))}
              </select>
            </div>

            <div className="export-settings-row">
              <label className="export-settings-label">Quality</label>
              <select
                className="export-settings-select"
                value={exportSettings.bitrate}
                onChange={(e) => setExportSettings({ bitrate: Number(e.target.value) })}
              >
                {QUALITY_PRESETS.map((q) => (
                  <option key={q.bitrate} value={q.bitrate}>{q.label}</option>
                ))}
              </select>
            </div>

            <div className="export-settings-actions">
              <button className="btn-export-cancel" onClick={() => setShowExportSettings(false)}>
                Cancel
              </button>
              <button className="btn-export" onClick={handleExport}>
                Export
              </button>
            </div>
          </div>
        </div>
      )}

      {isExporting && (
        <div className="export-overlay">
          <div className="export-modal">
            <div className="export-modal-title">Exporting video...</div>
            <div className="export-progress-bar">
              <div className="export-progress-fill" style={{ width: `${exportProgress}%` }} />
            </div>
            <div className="export-progress-text">{exportProgress}%</div>
            <button className="btn-export-cancel" onClick={handleCancelExport}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <SubtitleProgressBanner />

      <ApiKeysModal />

      <div className="app-layout">
        <MediaSidebar />
        <main className="editor-main">
          <PreviewPanel />
          <Timeline />
        </main>
        <PropertiesSidebar />
      </div>
    </>
  );
}
