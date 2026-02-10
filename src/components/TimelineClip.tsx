import { useCallback, useState, useMemo, memo } from 'react';
import { useEditorStore } from '../store/editorStore';
import ContextMenu from './ContextMenu';
import type { TimelineClip as TimelineClipType, ContextMenuItem, AnimatableProp } from '../types';

interface TimelineClipProps {
  clip: TimelineClipType;
  zoom: number;
  isSelected: boolean;
}

export default memo(function TimelineClip({ clip, zoom, isSelected }: TimelineClipProps) {
  const { selectClip, removeClip, updateClip } = useEditorStore();
  const tracks = useEditorStore((s) => s.tracks);
  const mediaFiles = useEditorStore((s) => s.mediaFiles);
  const mediaType = mediaFiles.find((m) => m.path === clip.mediaPath)?.type ?? 'video';

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
      const startY = e.clientY;
      const origStart = clip.startTime;
      const origTrack = clip.track;

      // Find all track-content elements for cross-track detection
      const trackHeight = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--track-height')) || 56;

      const onMove = (ev: MouseEvent) => {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        const dt = dx / zoom;
        const updates: Partial<TimelineClipType> = { startTime: Math.max(0, origStart + dt) };

        // Determine track change based on vertical offset
        const currentTracks = useEditorStore.getState().tracks;
        const origIdx = currentTracks.indexOf(origTrack);
        const trackOffset = Math.round(dy / trackHeight);
        const newIdx = Math.max(0, Math.min(currentTracks.length - 1, origIdx + trackOffset));
        if (currentTracks[newIdx] !== undefined) {
          updates.track = currentTracks[newIdx];
        }

        updateClip(clip.id, updates);
      };

      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [clip.id, clip.startTime, clip.track, zoom, selectClip, updateClip]
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

  // Collect all keyframe times for display
  const keyframeMarkers = useMemo(() => {
    if (!clip.keyframes) return [];
    const timeSet = new Set<number>();
    const allProps: AnimatableProp[] = ['x', 'y', 'scale', 'scaleX', 'scaleY', 'maskCenterX', 'maskCenterY', 'maskWidth', 'maskHeight', 'maskFeather'];
    for (const prop of allProps) {
      const kfs = clip.keyframes[prop];
      if (kfs) kfs.forEach((kf) => timeSet.add(kf.time));
    }
    return Array.from(timeSet).sort((a, b) => a - b);
  }, [clip.keyframes]);

  return (
    <>
      <div
        className={`timeline-clip ${mediaType}${isSelected ? ' selected' : ''}`}
        style={{ left, width }}
        onMouseDown={handleMouseDown}
        onContextMenu={handleContextMenu}
      >
        <div className="clip-handle clip-handle-left" onMouseDown={(e) => handleTrim(e, 'left')} />
        <span className="clip-label">{clip.mediaName}</span>
        {keyframeMarkers.map((time) => (
          <div
            key={time}
            className="clip-keyframe-marker"
            style={{ left: time * zoom }}
          />
        ))}
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
