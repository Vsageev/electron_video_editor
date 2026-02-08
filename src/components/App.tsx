import { useEffect, useCallback } from 'react';
import { useEditorStore } from '../store/editorStore';
import MediaSidebar from './MediaSidebar';
import PreviewPanel from './PreviewPanel';
import Timeline from './Timeline';
import PropertiesSidebar from './PropertiesSidebar';

export default function App() {
  const { removeClip } = useEditorStore();
  const timelineClips = useEditorStore((s) => s.timelineClips);
  const isExporting = useEditorStore((s) => s.isExporting);
  const exportProgress = useEditorStore((s) => s.exportProgress);
  const setIsExporting = useEditorStore((s) => s.setIsExporting);
  const setExportProgress = useEditorStore((s) => s.setExportProgress);

  // Delete key to remove selected clip
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      if (e.code === 'Delete' || e.code === 'Backspace') {
        const clipId = useEditorStore.getState().selectedClipId;
        if (clipId != null) {
          removeClip(clipId);
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [removeClip]);

  // Listen for export progress
  useEffect(() => {
    window.api.onExportProgress(({ percent }) => {
      setExportProgress(percent);
    });
    return () => {
      window.api.removeExportProgressListener();
    };
  }, [setExportProgress]);

  const handleExport = useCallback(async () => {
    if (timelineClips.length === 0) return;

    const outputPath = await window.api.exportDialog();
    if (!outputPath) return;

    setIsExporting(true);
    setExportProgress(0);

    const result = await window.api.exportVideo({
      outputPath,
      clips: timelineClips,
      width: 1920,
      height: 1080,
      fps: 30,
    });

    setIsExporting(false);

    if (!result.success) {
      alert('Export failed: ' + (result.error || 'Unknown error'));
    }
  }, [timelineClips, setIsExporting, setExportProgress]);

  const handleCancelExport = useCallback(() => {
    window.api.cancelExport();
    setIsExporting(false);
  }, [setIsExporting]);

  return (
    <>
      <div className="titlebar">
        <div className="titlebar-spacer" />
        <span className="titlebar-title">Video Editor</span>
        <div className="titlebar-actions">
          <button
            className="btn-export"
            onClick={handleExport}
            disabled={timelineClips.length === 0 || isExporting}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M8 1v9M4 6l4-4 4 4M2 11v2a2 2 0 002 2h8a2 2 0 002-2v-2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Export
          </button>
        </div>
      </div>

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
