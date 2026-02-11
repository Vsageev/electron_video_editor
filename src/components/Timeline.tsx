import { useRef, useState, useCallback, useMemo } from 'react';
import { useEditorStore } from '../store/editorStore';
import { formatTimeShort } from '../utils/formatTime';
import TimelineClipComponent from './TimelineClip';
import Tooltip from './Tooltip';

export default function Timeline() {
  const { timelineClips, selectedClipId, currentTime, zoom, setZoom, selectClip, addClipAtTime, mediaFiles, tracks, addTrack, removeTrack, splitClipAtPlayhead, rippleEnabled, toggleRipple, autoSnapEnabled, toggleAutoSnap } =
    useEditorStore();
  const containerRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);
  const wasPlayingRef = useRef(false);
  const [dragOverTrack, setDragOverTrack] = useState<number | null>(null);

  const clipsByTrack = useMemo(() => {
    const map = new Map<number, typeof timelineClips>();
    for (const trackId of tracks) {
      map.set(trackId, timelineClips.filter((c) => c.track === trackId));
    }
    return map;
  }, [timelineClips, tracks]);

  const timelineDuration = useMemo(() => {
    if (timelineClips.length === 0) return 30;
    return Math.max(...timelineClips.map((c) => c.startTime + c.duration), 30);
  }, [timelineClips]);

  const containerWidth = containerRef.current
    ? Math.max(timelineDuration * zoom, containerRef.current.clientWidth - 80)
    : timelineDuration * zoom;

  // Ruler marks
  const rulerMarks = useMemo(() => {
    let step = 1;
    if (zoom < 30) step = 10;
    else if (zoom < 60) step = 5;
    else if (zoom < 150) step = 2;

    const maxTime = Math.max(timelineDuration, containerWidth / zoom);
    const marks: { time: number; isMajor: boolean }[] = [];
    for (let t = 0; t <= maxTime; t += step) {
      const isMajor = t % (step * 5) === 0 || step === 1;
      marks.push({ time: t, isMajor });
    }
    return marks;
  }, [zoom, timelineDuration, containerWidth]);

  const seekToX = useCallback(
    (clientX: number, rect: DOMRect) => {
      const x = clientX - rect.left;
      const _time = Math.max(0, x / zoom);
      useEditorStore.getState().setCurrentTime(_time);
    },
    [zoom]
  );

  const handleScrubStart = useCallback(
    (e: React.MouseEvent) => {
      const ruler = containerRef.current?.querySelector('.time-ruler') as HTMLElement | null;
      if (!ruler) return;
      const rect = ruler.getBoundingClientRect();

      const store = useEditorStore.getState();
      wasPlayingRef.current = store.isPlaying;
      if (store.isPlaying) store.setIsPlaying(false);

      isDraggingRef.current = true;
      seekToX(e.clientX, rect);

      const onMove = (ev: MouseEvent) => {
        if (!isDraggingRef.current) return;
        seekToX(ev.clientX, rect);
      };
      const onUp = () => {
        isDraggingRef.current = false;
        if (wasPlayingRef.current) {
          useEditorStore.getState().setIsPlaying(true);
        }
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [zoom, seekToX]
  );

  const handlePlayheadDown = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      const container = containerRef.current;
      if (!container) return;
      const trackHeaderWidth = 80;

      const store = useEditorStore.getState();
      wasPlayingRef.current = store.isPlaying;
      if (store.isPlaying) store.setIsPlaying(false);

      isDraggingRef.current = true;

      const containerRect = container.getBoundingClientRect();

      const onMove = (ev: MouseEvent) => {
        if (!isDraggingRef.current) return;
        const x = ev.clientX - containerRect.left - trackHeaderWidth;
        const _time = Math.max(0, x / zoom);
        useEditorStore.getState().setCurrentTime(_time);
      };
      const onUp = () => {
        isDraggingRef.current = false;
        if (wasPlayingRef.current) {
          useEditorStore.getState().setIsPlaying(true);
        }
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [zoom]
  );

  const handleTrackClick = useCallback(
    (e: React.MouseEvent) => {
      if (!(e.target as HTMLElement).closest('.timeline-clip')) {
        selectClip(null);
      }
    },
    [selectClip]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    const target = (e.target as HTMLElement).closest('.track-content') as HTMLElement | null;
    if (target) {
      const trackId = target.dataset.track;
      setDragOverTrack(trackId ? Number(trackId) : null);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    const related = e.relatedTarget as HTMLElement | null;
    if (!related || !related.closest?.('.track-content')) {
      setDragOverTrack(null);
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOverTrack(null);

      const raw = e.dataTransfer.getData('application/json');
      if (!raw) return;

      let data: { mediaIndex: number };
      try {
        data = JSON.parse(raw);
      } catch {
        return;
      }

      const media = mediaFiles[data.mediaIndex];
      if (!media) return;

      // Determine target track
      const trackEl = (e.target as HTMLElement).closest('.track-content') as HTMLElement | null;
      const trackAttr = trackEl?.dataset.track;
      const track = trackAttr ? Number(trackAttr) : tracks[0];

      // Calculate startTime from drop position
      const contentRect = trackEl
        ? trackEl.getBoundingClientRect()
        : (e.target as HTMLElement).getBoundingClientRect();
      const x = e.clientX - contentRect.left;
      let startTime = Math.max(0, x / zoom);
      if (autoSnapEnabled) {
        const snapThreshold = 10 / zoom;
        const trackClipEdges = timelineClips
          .filter((c) => c.track === track)
          .flatMap((c) => [c.startTime, c.startTime + c.duration]);
        const candidates = [0, currentTime, ...trackClipEdges];
        let best = startTime;
        let bestDiff = Infinity;
        for (const candidate of candidates) {
          const diff = Math.abs(candidate - startTime);
          if (diff < bestDiff) {
            bestDiff = diff;
            best = candidate;
          }
        }
        if (bestDiff <= snapThreshold) {
          startTime = Math.max(0, best);
        }
      }

      addClipAtTime(media, track, startTime);
    },
    [mediaFiles, zoom, addClipAtTime, tracks, autoSnapEnabled, timelineClips, currentTime]
  );

  const playheadLeft = currentTime * zoom;

  return (
    <div className="timeline-section">
      <div className="timeline-toolbar">
        <div className="timeline-toolbar-left">
          <span className="sidebar-label">TIMELINE</span>
          <Tooltip label="Ripple edit" pos="bottom">
            <button
              className={`btn-icon btn-sm${rippleEnabled ? ' btn-ripple-active' : ''}`}
              onClick={toggleRipple}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M2 7h3l1.5-3 3 6L11 7h1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </Tooltip>
          <Tooltip label="Auto snapping" pos="bottom">
            <button
              className={`btn-icon btn-sm${autoSnapEnabled ? ' btn-snap-active' : ''}`}
              onClick={toggleAutoSnap}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M2 3h4v4H2zM8 7h4v4H8zM6 5l2 2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </Tooltip>
        </div>
        <div className="timeline-toolbar-right">
          <Tooltip label="Split clip (S)" pos="bottom">
            <button
              className="btn-icon btn-sm"
              onClick={splitClipAtPlayhead}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M7 1v12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                <path d="M3 4L7 7 3 10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M11 4L7 7 11 10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </Tooltip>
          <div style={{ width: 1, height: 16, background: 'var(--border-subtle)', margin: '0 4px' }} />
          <Tooltip label="Zoom out" pos="bottom">
            <button
              className="btn-icon btn-sm"
              onClick={() => setZoom(zoom - 20)}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M3 7h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </Tooltip>
          <input
            type="range"
            min="20"
            max="300"
            value={zoom}
            className="zoom-slider"
            onChange={(e) => setZoom(parseInt(e.target.value))}
          />
          <Tooltip label="Zoom in" pos="bottom">
            <button
              className="btn-icon btn-sm"
              onClick={() => setZoom(zoom + 20)}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M7 3v8M3 7h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </Tooltip>
        </div>
      </div>

      <div
        className="timeline-container"
        ref={containerRef}
        onMouseDown={handleTrackClick}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        {/* Time Ruler */}
        <div
          className="time-ruler"
          style={{ width: containerWidth }}
          onMouseDown={handleScrubStart}
        >
          {rulerMarks.map((mark) => (
            <div
              key={mark.time}
              className="ruler-mark"
              style={{ left: mark.time * zoom }}
            >
              <span className="ruler-mark-label">{formatTimeShort(mark.time)}</span>
              <div className={`ruler-mark-line${mark.isMajor ? ' major' : ''}`} />
            </div>
          ))}
        </div>

        {/* Playhead */}
        <div className="playhead" style={{ transform: `translateX(${playheadLeft}px)` }}>
          <div className="playhead-head" onMouseDown={handlePlayheadDown} />
          <div className="playhead-line" />
        </div>

        <div className="timeline-tracks-scroll">
          {/* Dynamic Tracks */}
          {tracks.map((trackId, index) => (
            <div className="track" key={trackId}>
              <div className="track-header">
                <span>Track {index + 1}</span>
                {tracks.length > 1 && (
                  <button
                    className="track-remove-btn"
                    onClick={() => removeTrack(trackId)}
                    title="Remove track"
                  >
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                      <path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                    </svg>
                  </button>
                )}
              </div>
              <div
                className={`track-content${dragOverTrack === trackId ? ' drag-over' : ''}`}
                data-track={trackId}
                onDragEnter={handleDragEnter}
                onDragLeave={handleDragLeave}
              >
                {(clipsByTrack.get(trackId) ?? []).map((clip) => (
                  <TimelineClipComponent
                    key={clip.id}
                    clip={clip}
                    zoom={zoom}
                    isSelected={clip.id === selectedClipId}
                  />
                ))}
              </div>
            </div>
          ))}

          {/* Add Track Row */}
          <div className="track track-add" onClick={addTrack}>
            <div className="track-header track-add-header">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              <span>Add Track</span>
            </div>
            <div className="track-content track-add-content">
              <span className="track-add-hint">Click to add a new track</span>
            </div>
          </div>

          {/* Empty State */}
          {timelineClips.length === 0 && (
            <div className="timeline-empty">
              <p>Drag media here or double-click a clip to add to timeline</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
