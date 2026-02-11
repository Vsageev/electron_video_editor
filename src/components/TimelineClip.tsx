import { useCallback, useState, useMemo, memo } from 'react';
import { useEditorStore } from '../store/editorStore';
import ContextMenu from './ContextMenu';
import type { TimelineClip as TimelineClipType, ContextMenuItem, AnimatableProp } from '../types';

interface TimelineClipProps {
  clip: TimelineClipType;
  zoom: number;
  isSelected: boolean;
}

const SNAP_THRESHOLD_PX = 10;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function findSnapTarget(raw: number, candidates: number[], threshold: number): number | null {
  let bestTarget: number | null = null;
  let bestDiff = Infinity;
  for (const candidate of candidates) {
    const diff = Math.abs(candidate - raw);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestTarget = candidate;
    }
  }
  return bestDiff <= threshold ? bestTarget : null;
}

export default memo(function TimelineClip({ clip, zoom, isSelected }: TimelineClipProps) {
  const { selectClip, removeClip, updateClip } = useEditorStore();
  const tracks = useEditorStore((s) => s.tracks);
  const mediaFiles = useEditorStore((s) => s.mediaFiles);
  const timelineClips = useEditorStore((s) => s.timelineClips);
  const currentTime = useEditorStore((s) => s.currentTime);
  const autoSnapEnabled = useEditorStore((s) => s.autoSnapEnabled);
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

      if (e.ctrlKey || e.metaKey) {
        selectClip(clip.id, { toggle: true });
        return; // No drag on toggle
      }
      // Plain click on unselected clip → single select
      if (!isSelected) {
        selectClip(clip.id);
      }
      // If already selected (possibly multi), keep selection for group drag

      const startX = e.clientX;
      const startY = e.clientY;
      const origStart = clip.startTime;
      const origTrack = clip.track;
      const clipDuration = clip.duration;
      const snapThreshold = SNAP_THRESHOLD_PX / zoom;

      // Find all track-content elements for cross-track detection
      const trackHeight = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--track-height')) || 56;

      const onMove = (ev: MouseEvent) => {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        const dt = dx / zoom;
        let nextStart = Math.max(0, origStart + dt);

        // Determine track change based on vertical offset
        const currentTracks = useEditorStore.getState().tracks;
        const origIdx = currentTracks.indexOf(origTrack);
        const trackOffset = Math.round(dy / trackHeight);
        const newIdx = Math.max(0, Math.min(currentTracks.length - 1, origIdx + trackOffset));
        const targetTrack = currentTracks[newIdx] ?? origTrack;

        if (autoSnapEnabled) {
          const edges = timelineClips
            .filter((c) => c.id !== clip.id && c.track === targetTrack)
            .flatMap((c) => [c.startTime, c.startTime + c.duration]);
          const candidates = [0, currentTime, ...edges];
          const startSnap = findSnapTarget(nextStart, candidates, snapThreshold);
          const endSnap = findSnapTarget(nextStart + clipDuration, candidates, snapThreshold);
          const startFromEndSnap = endSnap == null ? null : endSnap - clipDuration;
          const snapOptions = [
            ...(startSnap == null ? [] : [startSnap]),
            ...(startFromEndSnap == null ? [] : [startFromEndSnap]),
          ].map((value) => Math.max(0, value));

          if (snapOptions.length > 0) {
            let best = snapOptions[0];
            let bestDiff = Math.abs(best - nextStart);
            for (const option of snapOptions) {
              const diff = Math.abs(option - nextStart);
              if (diff < bestDiff) {
                bestDiff = diff;
                best = option;
              }
            }
            nextStart = best;
          }
        }

        const updates: Partial<TimelineClipType> = { startTime: nextStart };
        if (currentTracks[newIdx] !== undefined) {
          updates.track = targetTrack;
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
    [clip.id, clip.startTime, clip.track, clip.duration, zoom, selectClip, updateClip, autoSnapEnabled, timelineClips, currentTime, isSelected]
  );

  const handleTrim = useCallback(
    (e: React.MouseEvent, side: 'left' | 'right') => {
      e.stopPropagation();
      selectClip(clip.id);

      const startX = e.clientX;
      const origStart = clip.startTime;
      const origDuration = clip.duration;
      const origTrimStart = clip.trimStart;
      const origTrimEnd = clip.trimEnd;
      const snapThreshold = SNAP_THRESHOLD_PX / zoom;
      const snapCandidates = autoSnapEnabled
        ? [
            0,
            currentTime,
            ...timelineClips
              .filter((c) => c.id !== clip.id)
              .flatMap((c) => [c.startTime, c.startTime + c.duration]),
          ]
        : [];

      // Components and images have no fixed source duration — allow free resize
      const isFlexDuration = mediaType === 'component' || mediaType === 'image';

      const onMove = (ev: MouseEvent) => {
        const dx = ev.clientX - startX;
        const dt = dx / zoom;

        if (side === 'left') {
          if (isFlexDuration) {
            // Flex: move startTime, shrink/grow duration, no trimStart concept needed
            const origEnd = origStart + origDuration;
            let startTime = origStart + dt;
            let duration = origDuration - dt;
            if (duration < 0.1) {
              duration = 0.1;
              startTime = origEnd - 0.1;
            }
            if (startTime < 0) {
              duration = duration + startTime;
              startTime = 0;
              if (duration < 0.1) duration = 0.1;
            }
            if (autoSnapEnabled) {
              const snapped = findSnapTarget(startTime, snapCandidates, snapThreshold);
              if (snapped != null) {
                const clamped = Math.max(0, snapped);
                duration = origEnd - clamped;
                startTime = clamped;
                if (duration < 0.1) { duration = 0.1; startTime = origEnd - 0.1; }
              }
            }
            updateClip(clip.id, { startTime, duration, originalDuration: duration });
          } else {
            const newTrimStart = Math.max(0, origTrimStart + dt);
            const maxTrim = clip.originalDuration - clip.trimEnd - 0.1;
            let trimStart = Math.min(newTrimStart, maxTrim);
            let startTime = origStart + (trimStart - origTrimStart);
            if (autoSnapEnabled) {
              const minStart = origStart - origTrimStart;
              const maxStart = origStart + (maxTrim - origTrimStart);
              const snapped = findSnapTarget(startTime, snapCandidates, snapThreshold);
              if (snapped != null) {
                startTime = clamp(snapped, minStart, maxStart);
                trimStart = origTrimStart + (startTime - origStart);
              }
            }
            const duration = clip.originalDuration - trimStart - clip.trimEnd;
            updateClip(clip.id, { trimStart, duration, startTime });
          }
        } else {
          if (isFlexDuration) {
            // Flex: freely adjust duration with no upper bound
            let duration = Math.max(0.1, origDuration + dt);
            if (autoSnapEnabled) {
              const rawEnd = origStart + duration;
              const snapped = findSnapTarget(rawEnd, snapCandidates, snapThreshold);
              if (snapped != null) {
                duration = Math.max(0.1, snapped - origStart);
              }
            }
            updateClip(clip.id, { duration, originalDuration: duration });
          } else {
            const newTrimEnd = Math.max(0, origTrimEnd - dt);
            const maxTrim = clip.originalDuration - clip.trimStart - 0.1;
            let trimEnd = Math.min(newTrimEnd, maxTrim);
            let duration = clip.originalDuration - clip.trimStart - trimEnd;
            if (autoSnapEnabled) {
              const rawEnd = origStart + duration;
              const minEnd = origStart + 0.1;
              const maxEnd = origStart + clip.originalDuration - clip.trimStart;
              const snapped = findSnapTarget(rawEnd, snapCandidates, snapThreshold);
              if (snapped != null) {
                const endTime = clamp(snapped, minEnd, maxEnd);
                duration = endTime - origStart;
                trimEnd = clip.originalDuration - clip.trimStart - duration;
              }
            }
            updateClip(clip.id, { trimEnd, duration });
          }
        }
      };

      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [clip, zoom, selectClip, updateClip, autoSnapEnabled, timelineClips, currentTime]
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
