import { useEffect, useCallback, useRef, useState } from 'react';
import { useEditorStore } from '../store/editorStore';
import { exportToVideo } from '../utils/canvasExport';
import MediaSidebar from './MediaSidebar';
import PreviewPanel from './PreviewPanel';
import Timeline from './Timeline';
import PropertiesSidebar from './PropertiesSidebar';
import ApiKeysModal from './ApiKeysModal';
import ProjectPicker from './ProjectPicker';

const RESOLUTION_PRESETS = [
  { label: '4K (3840×2160)', width: 3840, height: 2160 },
  { label: '1080p (1920×1080)', width: 1920, height: 1080 },
  { label: '720p (1280×720)', width: 1280, height: 720 },
  { label: '480p (854×480)', width: 854, height: 480 },
];

const FPS_PRESETS = [24, 30, 60];

const QUALITY_PRESETS = [
  { label: 'Low (4 Mbps)', bitrate: 4_000_000 },
  { label: 'Medium (8 Mbps)', bitrate: 8_000_000 },
  { label: 'High (16 Mbps)', bitrate: 16_000_000 },
  { label: 'Ultra (32 Mbps)', bitrate: 32_000_000 },
];

export default function App() {
  const { removeClip } = useEditorStore();
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
        const clipId = useEditorStore.getState().selectedClipId;
        if (clipId != null) {
          removeClip(clipId);
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
  }, [removeClip]);

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
      const preset = RESOLUTION_PRESETS[Number(e.target.value)];
      setExportSettings({ width: preset.width, height: preset.height });
    },
    [setExportSettings],
  );

  const selectedResIdx = RESOLUTION_PRESETS.findIndex(
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
        <button
          className="titlebar-project-name"
          onClick={() => setShowProjectPicker(true)}
          title="Switch project"
        >
          <svg className="titlebar-project-folder-icon" width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path d="M2 4a1.5 1.5 0 011.5-1.5h3.25l1.5 1.5H12.5A1.5 1.5 0 0114 5.5v6a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 012 11.5V4z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
          </svg>
          <span>{currentProject || 'No Project'}</span>
          {isSaving && <span className="titlebar-save-indicator" title="Saving..." />}
          <svg className="titlebar-project-chevron" width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M3 4l2 2 2-2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <span className="titlebar-title">Video Editor</span>
        <div className="titlebar-actions">
          <button
            className="btn-icon titlebar-settings-btn"
            onClick={() => setShowSettings(true)}
            title="Settings"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M6.5 1.75a.75.75 0 011.5 0v.3a5.5 5.5 0 011.68.7l.21-.22a.75.75 0 011.06 1.06l-.21.22a5.5 5.5 0 01.7 1.68h.3a.75.75 0 010 1.5h-.3a5.5 5.5 0 01-.7 1.68l.22.21a.75.75 0 01-1.06 1.06l-.22-.21a5.5 5.5 0 01-1.68.7v.3a.75.75 0 01-1.5 0v-.3a5.5 5.5 0 01-1.68-.7l-.21.22a.75.75 0 01-1.06-1.06l.21-.22a5.5 5.5 0 01-.7-1.68h-.3a.75.75 0 010-1.5h.3a5.5 5.5 0 01.7-1.68l-.22-.21A.75.75 0 014.6 2.53l.22.21a5.5 5.5 0 011.68-.7v-.3zM8 10a2 2 0 100-4 2 2 0 000 4z" fill="currentColor"/>
            </svg>
          </button>
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
        <div className="project-banner project-banner-error">
          <div className="project-banner-content">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.2" />
              <path d="M8 5v3.5M8 10.5v.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
            <span>{projectError}</span>
          </div>
          <button className="project-banner-dismiss" onClick={() => setProjectError(null)}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
          </button>
        </div>
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
          <button className="project-banner-dismiss" onClick={clearProjectWarnings}>
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
                {RESOLUTION_PRESETS.map((p, i) => (
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
