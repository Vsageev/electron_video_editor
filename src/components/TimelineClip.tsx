import { useCallback, useState, useMemo, memo } from 'react';
import { useEditorStore, hasOverlap } from '../store/editorStore';
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
  const { selectClip, removeClip, updateClip, generateSubtitles, beginUndoBatch, endUndoBatch, setTrackInsertIndicator, insertTrackAndMoveClip, setDragInsertGhost, setCurrentTime } = useEditorStore();
  const tracks = useEditorStore((s) => s.tracks);
  const mediaFiles = useEditorStore((s) => s.mediaFiles);
  const timelineClips = useEditorStore((s) => s.timelineClips);
  const currentTime = useEditorStore((s) => s.currentTime);
  const autoSnapEnabled = useEditorStore((s) => s.autoSnapEnabled);
  const rippleEnabled = useEditorStore((s) => s.rippleEnabled);
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

      beginUndoBatch();

      let pendingInsertIdx: number | null = null;

      const onMove = (ev: MouseEvent) => {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        const dt = dx / zoom;
        let nextStart = Math.max(0, origStart + dt);

        // Determine track change based on vertical offset
        const currentTracks = useEditorStore.getState().tracks;
        const origIdx = currentTracks.indexOf(origTrack);

        // Raw Y position within the tracks area
        const rawY = origIdx * trackHeight + trackHeight / 2 + dy;
        const trackIndexFloat = rawY / trackHeight;
        const nearestIdx = Math.max(0, Math.min(currentTracks.length - 1, Math.round(trackIndexFloat - 0.5)));

        // Determine zone within the nearest track: top 25% = insert-before, bottom 25% = insert-after, middle = on-track
        const posInTrack = rawY - nearestIdx * trackHeight;
        const fraction = posInTrack / trackHeight;

        let insertIdx: number | null = null;
        let targetTrack: number;
        let onTrackIdx: number;

        if (fraction < 0.25 && nearestIdx !== origIdx) {
          // Edge zone: top of track → potential insert before nearestIdx
          // But first check if clip fits on the nearest track
          const neighborTrack = currentTracks[nearestIdx];
          const neighborClips = useEditorStore.getState().timelineClips.filter(
            (c) => c.track === neighborTrack && c.id !== clip.id,
          );
          if (!hasOverlap(neighborClips, nextStart, clipDuration)) {
            // Fits on neighbor → move there instead of inserting
            onTrackIdx = nearestIdx;
            targetTrack = neighborTrack;
          } else {
            insertIdx = nearestIdx;
            targetTrack = origTrack;
            onTrackIdx = origIdx;
          }
        } else if (fraction > 0.75 && nearestIdx !== origIdx) {
          // Edge zone: bottom of track → potential insert after nearestIdx
          const candidateInsert = nearestIdx + 1;
          // Suppress if this would just be adjacent to the clip's own track
          if (candidateInsert === origIdx || candidateInsert === origIdx + 1) {
            onTrackIdx = nearestIdx;
            targetTrack = currentTracks[onTrackIdx] ?? origTrack;
          } else {
            // Check if clip fits on the nearest track
            const neighborTrack = currentTracks[nearestIdx];
            const neighborClips = useEditorStore.getState().timelineClips.filter(
              (c) => c.track === neighborTrack && c.id !== clip.id,
            );
            if (!hasOverlap(neighborClips, nextStart, clipDuration)) {
              onTrackIdx = nearestIdx;
              targetTrack = neighborTrack;
            } else {
              insertIdx = candidateInsert;
              targetTrack = origTrack;
              onTrackIdx = origIdx;
            }
          }
        } else {
          // On-track behavior (middle 50%)
          onTrackIdx = nearestIdx;
          targetTrack = currentTracks[onTrackIdx] ?? origTrack;
        }

        pendingInsertIdx = insertIdx;
        setTrackInsertIndicator(insertIdx);
        // Ghost will be updated after snapping below

        if (autoSnapEnabled) {
          const snapTrack = insertIdx != null ? origTrack : targetTrack;
          const edges = timelineClips
            .filter((c) => c.id !== clip.id && c.track === snapTrack)
            .flatMap((c) => [c.startTime, c.startTime + c.duration]);
          const candidates = [0, currentTime, ...edges];
          const startSnap = findSnapTarget(nextStart, candidates, snapThreshold);
          const endSnap = findSnapTarget(nextStart + clipDuration, candidates, snapThreshold);
          const startFromEndSnap = endSnap == null ? null : endSnap - clipDuration;
          const snapOptions = [
            ...(startSnap == null ? [] : [{ value: Math.max(0, startSnap), snapAt: startSnap }]),
            ...(startFromEndSnap == null ? [] : [{ value: Math.max(0, startFromEndSnap), snapAt: endSnap! }]),
          ];

          if (snapOptions.length > 0) {
            let best = snapOptions[0];
            let bestDiff = Math.abs(best.value - nextStart);
            for (const option of snapOptions) {
              const diff = Math.abs(option.value - nextStart);
              if (diff < bestDiff) {
                bestDiff = diff;
                best = option;
              }
            }
            nextStart = best.value;
            useEditorStore.getState().setSnapLineX(best.snapAt * zoom);
          } else {
            useEditorStore.getState().setSnapLineX(null);
          }
        } else {
          useEditorStore.getState().setSnapLineX(null);
        }

        // If in insert mode, keep clip on its original track but show ghost
        if (insertIdx != null) {
          updateClip(clip.id, { startTime: nextStart });
          setDragInsertGhost({ insertIndex: insertIdx, left: nextStart * zoom, width: clipDuration * zoom });
        } else {
          setDragInsertGhost(null);
          const updates: Partial<TimelineClipType> = { startTime: nextStart };
          if (currentTracks[onTrackIdx] !== undefined) {
            updates.track = targetTrack;
          }
          updateClip(clip.id, updates);
        }
      };

      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        if (pendingInsertIdx != null) {
          const currentClip = useEditorStore.getState().timelineClips.find((c) => c.id === clip.id);
          insertTrackAndMoveClip(pendingInsertIdx, clip.id, currentClip?.startTime ?? clip.startTime);
        }
        setTrackInsertIndicator(null);
        setDragInsertGhost(null);
        useEditorStore.getState().setSnapLineX(null);
        endUndoBatch();
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [clip.id, clip.startTime, clip.track, clip.duration, zoom, selectClip, updateClip, autoSnapEnabled, timelineClips, currentTime, isSelected, beginUndoBatch, endUndoBatch, setTrackInsertIndicator, insertTrackAndMoveClip, setDragInsertGhost]
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
      const origCurrentTime = currentTime;
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

      // Track the previous end time for ripple shift calculations
      let prevEnd = origStart + origDuration;

      beginUndoBatch();

      const onMove = (ev: MouseEvent) => {
        const dx = ev.clientX - startX;
        const dt = dx / zoom;
        let snapAt: number | null = null;

        if (side === 'left') {
          if (isFlexDuration) {
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
                snapAt = snapped;
              }
            }
            updateClip(clip.id, { startTime, duration, originalDuration: duration });
            // Trim preview: scrub to trim edge
            setCurrentTime(startTime);
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
                snapAt = snapped;
              }
            }
            const duration = clip.originalDuration - trimStart - clip.trimEnd;
            updateClip(clip.id, { trimStart, duration, startTime });
            // Trim preview: scrub to trim edge
            setCurrentTime(startTime);
          }
        } else {
          if (isFlexDuration) {
            let duration = Math.max(0.1, origDuration + dt);
            if (autoSnapEnabled) {
              const rawEnd = origStart + duration;
              const snapped = findSnapTarget(rawEnd, snapCandidates, snapThreshold);
              if (snapped != null) {
                duration = Math.max(0.1, snapped - origStart);
                snapAt = snapped;
              }
            }
            const newEnd = origStart + duration;
            updateClip(clip.id, { duration, originalDuration: duration });
            // Ripple: shift later clips by the end-time change
            if (rippleEnabled) {
              const shift = newEnd - prevEnd;
              if (Math.abs(shift) > 0.001) {
                const store = useEditorStore.getState();
                const laterClips = store.timelineClips.filter(
                  (c) => c.id !== clip.id && c.track === clip.track && c.startTime >= prevEnd - 0.001,
                );
                for (const c of laterClips) {
                  updateClip(c.id, { startTime: Math.max(0, c.startTime + shift) });
                }
              }
              prevEnd = newEnd;
            }
            // Trim preview: scrub to trim edge
            setCurrentTime(origStart + duration);
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
                snapAt = snapped;
              }
            }
            const newEnd = origStart + duration;
            updateClip(clip.id, { trimEnd, duration });
            // Ripple: shift later clips by the end-time change
            if (rippleEnabled) {
              const shift = newEnd - prevEnd;
              if (Math.abs(shift) > 0.001) {
                const store = useEditorStore.getState();
                const laterClips = store.timelineClips.filter(
                  (c) => c.id !== clip.id && c.track === clip.track && c.startTime >= prevEnd - 0.001,
                );
                for (const c of laterClips) {
                  updateClip(c.id, { startTime: Math.max(0, c.startTime + shift) });
                }
              }
              prevEnd = newEnd;
            }
            // Trim preview: scrub to trim edge
            setCurrentTime(origStart + duration);
          }
        }

        // Show snap indicator line
        useEditorStore.getState().setSnapLineX(snapAt != null ? snapAt * zoom : null);
      };

      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        useEditorStore.getState().setSnapLineX(null);
        // Restore currentTime after trim preview
        setCurrentTime(origCurrentTime);
        endUndoBatch();
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [clip, zoom, selectClip, updateClip, autoSnapEnabled, timelineClips, currentTime, beginUndoBatch, endUndoBatch, rippleEnabled, setCurrentTime]
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      selectClip(clip.id);
      const items: ContextMenuItem[] = [];
      items.push({
        label: 'Copy',
        action: () => useEditorStore.getState().copySelectedClips(),
      });
      items.push({ divider: true });
      if (mediaType === 'video' || mediaType === 'audio') {
        items.push({
          label: 'Generate Subtitles',
          action: () => generateSubtitles(clip.id),
        });
        items.push({ divider: true });
      }
      items.push({
        label: 'Remove Clip',
        danger: true,
        action: () => removeClip(clip.id),
      });
      setContextMenu({
        x: e.clientX,
        y: e.clientY,
        items,
      });
    },
    [clip.id, selectClip, removeClip, generateSubtitles, mediaType]
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
