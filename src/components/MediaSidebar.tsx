import { useState, useCallback, useEffect, useRef } from 'react';
import { useEditorStore } from '../store/editorStore';
import { isVideoExt, isAudioExt, isComponentExt, getMediaDuration, formatTime } from '../utils/formatTime';
import { loadComponent } from '../utils/componentLoader';
import ContextMenu from './ContextMenu';
import type { MediaFile, ContextMenuItem } from '../types';

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

      const duration = type === 'component'
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

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, media: MediaFile, index: number) => {
      e.preventDefault();
      setContextMenu({
        x: e.clientX,
        y: e.clientY,
        items: [
          { label: 'Add to Timeline', action: () => addClip(media) },
          {
            label: 'Remove from Media',
            danger: true,
            action: () => removeMediaFile(index),
          },
        ],
      });
    },
    [addClip, removeMediaFile]
  );

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <span className="sidebar-label">MEDIA</span>
        <div className="sidebar-header-actions">
          {builtinComponents.length > 0 && (
            <div className="builtin-dropdown-wrapper">
              <button
                className="btn-icon"
                onClick={(e) => { e.stopPropagation(); setShowBuiltins((v) => !v); }}
                title="Add built-in component"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M5 3L2 8l3 5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M11 3l3 5-3 5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
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
          <button className="btn-icon" onClick={handleImport} title="Import media">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>
      {importError && (
        <div className="media-import-error" onClick={() => setImportError(null)}>
          {importError}
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
              }}
              onClick={() => handleClick(idx)}
              onDoubleClick={() => handleDoubleClick(media)}
              onContextMenu={(e) => handleContextMenu(e, media, idx)}
            >
              <div className={`media-item-icon${media.type === 'audio' ? ' audio' : media.type === 'component' ? ' component' : ''}`}>
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
                <div className="media-item-meta">{formatTime(media.duration)}</div>
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
