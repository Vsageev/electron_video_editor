import { useRef, useEffect, useCallback, useState, useMemo, memo } from 'react';
import { useEditorStore } from '../store/editorStore';
import { formatTime } from '../utils/formatTime';
import { filePathToFileUrl } from '../utils/fileUrl';
import type { TimelineClip } from '../types';

type HandleDir = 'nw' | 'ne' | 'sw' | 'se';
const HANDLE_DIRS: HandleDir[] = ['nw', 'ne', 'sw', 'se'];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fitSize(nw: number, nh: number, cw: number, ch: number) {
  if (!nw || !nh || !cw || !ch) return { w: 0, h: 0 };
  const aspect = nw / nh;
  return aspect > cw / ch
    ? { w: cw, h: cw / aspect }
    : { w: ch * aspect, h: ch };
}

function makeTransformStyle(
  x: number,
  y: number,
  scale: number,
  bw: number,
  bh: number,
): React.CSSProperties {
  return {
    position: 'absolute',
    width: bw * scale,
    height: bh * scale,
    left: '50%',
    top: '50%',
    transform: `translate(calc(-50% + ${x * bw}px), calc(-50% + ${y * bh}px))`,
  };
}

// ---------------------------------------------------------------------------
// VideoLayer – renders one video clip on the canvas
// ---------------------------------------------------------------------------

const VideoLayer = memo(function VideoLayer({
  clip,
  globalTime,
  isPlaying,
  containerW,
  containerH,
  onNaturalSize,
}: {
  clip: TimelineClip;
  globalTime: number;
  isPlaying: boolean;
  containerW: number;
  containerH: number;
  onNaturalSize: (id: number, w: number, h: number) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [natural, setNatural] = useState({ w: 0, h: 0 });

  const localTime = globalTime - clip.startTime + clip.trimStart;
  const src = useMemo(() => filePathToFileUrl(clip.mediaPath), [clip.mediaPath]);

  // When metadata loads, store natural size and seek to correct frame
  const handleMetadata = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    const w = v.videoWidth;
    const h = v.videoHeight;
    setNatural({ w, h });
    onNaturalSize(clip.id, w, h);
    v.currentTime = Math.max(0, localTime);
    if (isPlaying) v.play().catch(() => {});
  }, [clip.id, localTime, isPlaying, onNaturalSize]);

  // Play / pause
  useEffect(() => {
    const v = videoRef.current;
    if (!v || v.readyState < 1) return;
    if (isPlaying) v.play().catch(() => {});
    else v.pause();
  }, [isPlaying]);

  // Seek when paused (timeline scrubbing)
  useEffect(() => {
    if (isPlaying) return;
    const v = videoRef.current;
    if (!v || v.readyState < 1) return;
    const target = Math.max(0, localTime);
    if (Math.abs(v.currentTime - target) > 0.04) {
      v.currentTime = target;
    }
  }, [localTime, isPlaying]);

  const base = fitSize(natural.w, natural.h, containerW, containerH);
  const style: React.CSSProperties =
    base.w > 0
      ? { ...makeTransformStyle(clip.x, clip.y, clip.scale, base.w, base.h), pointerEvents: 'none' }
      : { position: 'absolute', opacity: 0, pointerEvents: 'none' };

  return (
    <video
      ref={videoRef}
      src={src}
      style={style}
      preload="auto"
      onLoadedMetadata={handleMetadata}
      playsInline
    />
  );
});

// ---------------------------------------------------------------------------
// PreviewPanel
// ---------------------------------------------------------------------------

export default function PreviewPanel() {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const standaloneRef = useRef<HTMLVideoElement>(null);
  const isSeekedByStandalone = useRef(false);

  const [wrapperSize, setWrapperSize] = useState({ w: 0, h: 0 });
  const [naturalSizes, setNaturalSizes] = useState<Record<number, { w: number; h: number }>>({});

  // ---- Store subscriptions ----
  const timelineClips = useEditorStore((s) => s.timelineClips);
  const selectedClipId = useEditorStore((s) => s.selectedClipId);
  const selectedClip = useEditorStore((s) => {
    const id = s.selectedClipId;
    return id != null ? s.timelineClips.find((c) => c.id === id) ?? null : null;
  });
  const currentTime = useEditorStore((s) => s.currentTime);
  const isPlaying = useEditorStore((s) => s.isPlaying);
  const duration = useEditorStore((s) => s.duration);
  const previewMediaPath = useEditorStore((s) => s.previewMediaPath);
  const previewMediaType = useEditorStore((s) => s.previewMediaType);
  const updateClip = useEditorStore((s) => s.updateClip);
  const setCurrentTime = useEditorStore((s) => s.setCurrentTime);
  const setIsPlaying = useEditorStore((s) => s.setIsPlaying);
  const setDuration = useEditorStore((s) => s.setDuration);

  // ---- Track wrapper size via ResizeObserver ----
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) =>
      setWrapperSize({ w: e.contentRect.width, h: e.contentRect.height }),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Natural-size callback from VideoLayers
  const handleNaturalSize = useCallback((id: number, w: number, h: number) => {
    setNaturalSizes((prev) => ({ ...prev, [id]: { w, h } }));
  }, []);

  // ---- Derived state ----
  const hasTimelineClips = timelineClips.length > 0;

  const visibleVideoClips = useMemo(
    () =>
      timelineClips.filter(
        (c) =>
          c.type === 'video' &&
          currentTime >= c.startTime &&
          currentTime < c.startTime + c.duration,
      ),
    [timelineClips, currentTime],
  );

  const timelineDuration = useMemo(() => {
    if (!hasTimelineClips) return 0;
    return Math.max(...timelineClips.map((c) => c.startTime + c.duration));
  }, [timelineClips, hasTimelineClips]);

  const showStandalone =
    !hasTimelineClips && !!previewMediaPath && previewMediaType === 'video';
  const showPlaceholder = !hasTimelineClips && !showStandalone;

  // ---- Keep store duration in sync with timeline ----
  useEffect(() => {
    if (hasTimelineClips) setDuration(timelineDuration);
  }, [hasTimelineClips, timelineDuration, setDuration]);

  // ---- Playback clock (rAF, timeline mode) ----
  useEffect(() => {
    if (!isPlaying || !hasTimelineClips) return;
    let lastTs = performance.now();
    let rafId: number;

    const tick = (now: number) => {
      const dt = (now - lastTs) / 1000;
      lastTs = now;
      const t = useEditorStore.getState().currentTime + dt;
      if (timelineDuration > 0 && t >= timelineDuration) {
        setCurrentTime(timelineDuration);
        setIsPlaying(false);
        return;
      }
      setCurrentTime(t);
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [isPlaying, hasTimelineClips, timelineDuration, setCurrentTime, setIsPlaying]);

  // ---- Standalone preview (media sidebar click, no timeline clips) ----
  useEffect(() => {
    if (!showStandalone) return;
    const v = standaloneRef.current;
    if (!v) return;
    const onMeta = () => setDuration(v.duration);
    const onTime = () => {
      isSeekedByStandalone.current = true;
      setCurrentTime(v.currentTime);
    };
    const onEnd = () => setIsPlaying(false);
    v.addEventListener('loadedmetadata', onMeta);
    v.addEventListener('timeupdate', onTime);
    v.addEventListener('ended', onEnd);
    return () => {
      v.removeEventListener('loadedmetadata', onMeta);
      v.removeEventListener('timeupdate', onTime);
      v.removeEventListener('ended', onEnd);
    };
  }, [showStandalone, setDuration, setCurrentTime, setIsPlaying]);

  useEffect(() => {
    if (!showStandalone) return;
    const v = standaloneRef.current;
    if (!v) return;
    if (isPlaying) v.play().catch(() => {});
    else v.pause();
  }, [isPlaying, showStandalone]);

  useEffect(() => {
    if (!showStandalone) return;
    if (isSeekedByStandalone.current) {
      isSeekedByStandalone.current = false;
      return;
    }
    const v = standaloneRef.current;
    if (!v || !v.readyState) return;
    if (Math.abs(v.currentTime - currentTime) > 0.05) {
      v.currentTime = currentTime;
    }
  }, [currentTime, showStandalone]);

  // ---- Transform: move ----
  const getSelectedBase = useCallback(() => {
    if (!selectedClip || selectedClip.type !== 'video') return { w: 0, h: 0 };
    const nat = naturalSizes[selectedClip.id];
    if (!nat) return { w: 0, h: 0 };
    return fitSize(nat.w, nat.h, wrapperSize.w, wrapperSize.h);
  }, [selectedClip, naturalSizes, wrapperSize]);

  const handleMoveDown = useCallback(
    (e: React.MouseEvent) => {
      if (!selectedClip || selectedClip.type !== 'video') return;
      if ((e.target as HTMLElement).dataset.handle) return;
      e.preventDefault();
      e.stopPropagation();

      const startX = e.clientX;
      const startY = e.clientY;
      const origX = selectedClip.x;
      const origY = selectedClip.y;
      const base = getSelectedBase();
      if (!base.w) return;
      const id = selectedClip.id;

      const onMove = (ev: MouseEvent) => {
        updateClip(id, {
          x: origX + (ev.clientX - startX) / base.w,
          y: origY + (ev.clientY - startY) / base.h,
        });
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [selectedClip, getSelectedBase, updateClip],
  );

  // ---- Transform: resize ----
  const handleResizeDown = useCallback(
    (e: React.MouseEvent, dir: HandleDir) => {
      if (!selectedClip || selectedClip.type !== 'video') return;
      e.preventDefault();
      e.stopPropagation();

      const startX = e.clientX;
      const startY = e.clientY;
      const origScale = selectedClip.scale;
      const origXPos = selectedClip.x;
      const origYPos = selectedClip.y;
      const base = getSelectedBase();
      if (!base.w) return;
      const id = selectedClip.id;

      const onMove = (ev: MouseEvent) => {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        const signX = dir === 'nw' || dir === 'sw' ? -1 : 1;
        const signY = dir === 'nw' || dir === 'ne' ? -1 : 1;
        const delta = (dx * signX + dy * signY) / 2;
        const newScale = Math.max(0.1, origScale + delta / (base.w * 0.5));
        const dScale = newScale - origScale;
        updateClip(id, {
          scale: newScale,
          x: origXPos + (dir === 'nw' || dir === 'sw' ? dScale * 0.5 : -dScale * 0.5),
          y: origYPos + (dir === 'nw' || dir === 'ne' ? dScale * 0.5 : -dScale * 0.5),
        });
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [selectedClip, getSelectedBase, updateClip],
  );

  // ---- Transport ----
  const togglePlay = useCallback(() => setIsPlaying(!isPlaying), [isPlaying, setIsPlaying]);

  const skipBack = useCallback(() => {
    setCurrentTime(Math.max(0, useEditorStore.getState().currentTime - 5));
  }, [setCurrentTime]);

  const skipForward = useCallback(() => {
    const s = useEditorStore.getState();
    setCurrentTime(Math.min(s.duration, s.currentTime + 5));
  }, [setCurrentTime]);

  // ---- Keyboard shortcuts ----
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      switch (e.code) {
        case 'Space':
          e.preventDefault();
          togglePlay();
          break;
        case 'ArrowLeft': {
          const s = useEditorStore.getState();
          setCurrentTime(Math.max(0, s.currentTime - (e.shiftKey ? 1 : 1 / 30)));
          break;
        }
        case 'ArrowRight': {
          const s = useEditorStore.getState();
          setCurrentTime(Math.min(s.duration, s.currentTime + (e.shiftKey ? 1 : 1 / 30)));
          break;
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [togglePlay, setCurrentTime]);

  // ---- Handle overlay ----
  const showHandles =
    selectedClip &&
    selectedClip.type === 'video' &&
    visibleVideoClips.some((c) => c.id === selectedClip.id);

  let handleStyle: React.CSSProperties | undefined;
  if (showHandles && selectedClip) {
    const base = getSelectedBase();
    if (base.w > 0) {
      handleStyle = makeTransformStyle(
        selectedClip.x,
        selectedClip.y,
        selectedClip.scale,
        base.w,
        base.h,
      );
    }
  }

  // ---- Render ----
  return (
    <div className="preview-container">
      <div className="preview-wrapper" ref={wrapperRef}>
        {/* Timeline composite: one VideoLayer per visible video clip */}
        {hasTimelineClips &&
          visibleVideoClips.map((clip) => (
            <VideoLayer
              key={clip.id}
              clip={clip}
              globalTime={currentTime}
              isPlaying={isPlaying}
              containerW={wrapperSize.w}
              containerH={wrapperSize.h}
              onNaturalSize={handleNaturalSize}
            />
          ))}

        {/* Standalone preview (media sidebar click, no timeline clips) */}
        {showStandalone && (
          <video
            ref={standaloneRef}
            src={filePathToFileUrl(previewMediaPath!)}
            className="standalone-video"
            preload="auto"
            playsInline
          />
        )}

        {/* Transform handles for selected clip */}
        {showHandles && handleStyle && (
          <div
            className="canvas-transform-box"
            style={handleStyle}
            onMouseDown={handleMoveDown}
          >
            {HANDLE_DIRS.map((dir) => (
              <div
                key={dir}
                className={`canvas-handle canvas-handle-${dir}`}
                data-handle="1"
                onMouseDown={(e) => handleResizeDown(e, dir)}
              />
            ))}
          </div>
        )}

        {/* Empty placeholder */}
        {showPlaceholder && (
          <div className="preview-placeholder">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none">
              <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.5" />
              <path d="M10 9l5 3-5 3V9z" fill="currentColor" opacity="0.4" />
            </svg>
            <p>Select a clip to preview</p>
          </div>
        )}
      </div>

      {/* Transport controls */}
      <div className="transport-controls">
        <div className="transport-left">
          <span className="timecode">{formatTime(currentTime)}</span>
        </div>
        <div className="transport-center">
          <button className="btn-transport" onClick={skipBack} title="Skip back">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M12 3L6 8l6 5V3z" fill="currentColor" />
              <rect x="3" y="3" width="2" height="10" rx="0.5" fill="currentColor" />
            </svg>
          </button>
          <button className="btn-transport btn-play" onClick={togglePlay} title="Play/Pause">
            {isPlaying ? (
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <rect x="4" y="3" width="3" height="12" rx="1" fill="currentColor" />
                <rect x="11" y="3" width="3" height="12" rx="1" fill="currentColor" />
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <path d="M5 3l10 6-10 6V3z" fill="currentColor" />
              </svg>
            )}
          </button>
          <button className="btn-transport" onClick={skipForward} title="Skip forward">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M4 3l6 5-6 5V3z" fill="currentColor" />
              <rect x="11" y="3" width="2" height="10" rx="0.5" fill="currentColor" />
            </svg>
          </button>
        </div>
        <div className="transport-right">
          <span className="timecode">{formatTime(duration)}</span>
        </div>
      </div>
    </div>
  );
}
