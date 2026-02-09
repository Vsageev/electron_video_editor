import { useState, useCallback } from 'react';
import { useEditorStore } from '../store/editorStore';
import { isVideoExt, getMediaDuration, formatTime } from '../utils/formatTime';
import ContextMenu from './ContextMenu';
import type { MediaFile, ContextMenuItem } from '../types';

export default function MediaSidebar() {
  const {
    mediaFiles,
    selectedMediaIndex,
    addMediaFiles,
    removeMediaFile,
    selectMedia,
    addClip,
    setPreviewMedia,
  } = useEditorStore();

  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    items: ContextMenuItem[];
  } | null>(null);

  const handleImport = useCallback(async () => {
    const files = await window.api.openFileDialog();
    if (!files.length) return;

    const newMediaFiles: MediaFile[] = [];
    for (const file of files) {
      const type = isVideoExt(file.ext) ? 'video' : 'audio';
      const duration = await getMediaDuration(file.path, type);
      newMediaFiles.push({
        path: file.path,
        name: file.name,
        ext: file.ext,
        type: type as 'video' | 'audio',
        duration,
      });
    }
    addMediaFiles(newMediaFiles);
  }, [addMediaFiles]);

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
        <button className="btn-icon" onClick={handleImport} title="Import media">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>
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
              <div className={`media-item-icon${media.type === 'audio' ? ' audio' : ''}`}>
                {media.type === 'video' ? (
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <rect x="2" y="4" width="12" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
                    <path d="M7 7l3 1.5-3 1.5V7z" fill="currentColor" opacity="0.6" />
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
