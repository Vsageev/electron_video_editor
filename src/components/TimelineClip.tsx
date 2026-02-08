import { useCallback, useState, memo } from 'react';
import { useEditorStore } from '../store/editorStore';
import ContextMenu from './ContextMenu';
import type { TimelineClip as TimelineClipType, ContextMenuItem } from '../types';

interface TimelineClipProps {
  clip: TimelineClipType;
  zoom: number;
  isSelected: boolean;
}

export default memo(function TimelineClip({ clip, zoom, isSelected }: TimelineClipProps) {
  const { selectClip, removeClip, updateClip } = useEditorStore();

  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    items: ContextMenuItem[];
  } | null>(null);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if ((e.target as HTMLElement).classList.contains('clip-handle')) return;
      e.stopPropagation();
      selectClip(clip.id);

      const startX = e.clientX;
      const origStart = clip.startTime;

      const onMove = (ev: MouseEvent) => {
        const dx = ev.clientX - startX;
        const dt = dx / zoom;
        updateClip(clip.id, { startTime: Math.max(0, origStart + dt) });
      };

      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [clip.id, clip.startTime, zoom, selectClip, updateClip]
  );

  const handleTrim = useCallback(
    (e: React.MouseEvent, side: 'left' | 'right') => {
      e.stopPropagation();
      selectClip(clip.id);

      const startX = e.clientX;
      const origStart = clip.startTime;
      const origTrimStart = clip.trimStart;
      const origTrimEnd = clip.trimEnd;

      const onMove = (ev: MouseEvent) => {
        const dx = ev.clientX - startX;
        const dt = dx / zoom;

        if (side === 'left') {
          const newTrimStart = Math.max(0, origTrimStart + dt);
          const maxTrim = clip.originalDuration - clip.trimEnd - 0.1;
          const trimStart = Math.min(newTrimStart, maxTrim);
          const duration = clip.originalDuration - trimStart - clip.trimEnd;
          const startTime = origStart + (trimStart - origTrimStart);
          updateClip(clip.id, { trimStart, duration, startTime });
        } else {
          const newTrimEnd = Math.max(0, origTrimEnd - dt);
          const maxTrim = clip.originalDuration - clip.trimStart - 0.1;
          const trimEnd = Math.min(newTrimEnd, maxTrim);
          const duration = clip.originalDuration - clip.trimStart - trimEnd;
          updateClip(clip.id, { trimEnd, duration });
        }
      };

      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [clip, zoom, selectClip, updateClip]
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      selectClip(clip.id);
      setContextMenu({
        x: e.clientX,
        y: e.clientY,
        items: [
          {
            label: 'Remove Clip',
            danger: true,
            action: () => removeClip(clip.id),
          },
        ],
      });
    },
    [clip.id, selectClip, removeClip]
  );

  const left = clip.startTime * zoom;
  const width = clip.duration * zoom;

  return (
    <>
      <div
        className={`timeline-clip ${clip.type}${isSelected ? ' selected' : ''}`}
        style={{ left, width }}
        onMouseDown={handleMouseDown}
        onContextMenu={handleContextMenu}
      >
        <div className="clip-handle clip-handle-left" onMouseDown={(e) => handleTrim(e, 'left')} />
        <span className="clip-label">{clip.mediaName}</span>
        <div className="clip-handle clip-handle-right" onMouseDown={(e) => handleTrim(e, 'right')} />
      </div>
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenu.items}
          onClose={() => setContextMenu(null)}
        />
      )}
    </>
  );
});
