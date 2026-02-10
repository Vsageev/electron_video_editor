import { useRef, useEffect, useCallback, useState, useMemo } from 'react';
import { useEditorStore } from '../store/editorStore';
import { formatTime } from '../utils/formatTime';
import { filePathToFileUrl } from '../utils/fileUrl';
import { getAnimatedTransform, getAnimatedMask } from '../utils/keyframeEngine';
import ClipLayer from './ClipLayer';
import type { AnimatableProp, ClipMask } from '../types';

type CornerDir = 'nw' | 'ne' | 'sw' | 'se';
type EdgeDir = 'n' | 's' | 'e' | 'w';
const CORNER_DIRS: CornerDir[] = ['nw', 'ne', 'sw', 'se'];
const EDGE_DIRS: EdgeDir[] = ['n', 's', 'e', 'w'];

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
  sX = 1,
  sY = 1,
): React.CSSProperties {
  return {
    position: 'absolute',
    width: bw * scale * sX,
    height: bh * scale * sY,
    left: '50%',
    top: '50%',
    transform: `translate(calc(-50% + ${x * bw}px), calc(-50% + ${y * bh}px))`,
  };
}

function buildClipPath(mask: ClipMask): string {
  const cx = mask.centerX * 100;
  const cy = mask.centerY * 100;
  const hw = (mask.width / 2) * 100;
  const hh = (mask.height / 2) * 100;

  if (mask.shape === 'ellipse') {
    const inner = `ellipse(${hw}% ${hh}% at ${cx}% ${cy}%)`;
    if (!mask.invert) return inner;
    return `polygon(evenodd, 0% 0%, 100% 0%, 100% 100%, 0% 100%, 0% 0%, ${cx - hw}% ${cy}%, ${cx}% ${cy - hh}%, ${cx + hw}% ${cy}%, ${cx}% ${cy + hh}%, ${cx - hw}% ${cy}%)`;
  }

  const top = cy - hh;
  const right = 100 - (cx + hw);
  const bottom = 100 - (cy + hh);
  const left = cx - hw;
  const r = mask.borderRadius * Math.min(hw, hh) * 2;
  const rStr = r > 0 ? ` round ${r}%` : '';

  if (!mask.invert) {
    return `inset(${top}% ${right}% ${bottom}% ${left}%${rStr})`;
  }
  const l = left;
  const t = top;
  const rr = 100 - right;
  const bb = 100 - bottom;
  return `polygon(evenodd, 0% 0%, 100% 0%, 100% 100%, 0% 100%, 0% 0%, ${l}% ${t}%, ${rr}% ${t}%, ${rr}% ${bb}%, ${l}% ${bb}%, ${l}% ${t}%)`;
}

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
  const mediaFiles = useEditorStore((s) => s.mediaFiles);
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
  const addKeyframe = useEditorStore((s) => s.addKeyframe);
  const updateKeyframe = useEditorStore((s) => s.updateKeyframe);
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

  const selectClip = useEditorStore((s) => s.selectClip);

  // Natural-size callback from ClipLayers
  const handleNaturalSize = useCallback((id: number, w: number, h: number) => {
    setNaturalSizes((prev) => ({ ...prev, [id]: { w, h } }));
  }, []);

  const handleSelectClip = useCallback((id: number) => {
    selectClip(id);
  }, [selectClip]);

  const handleWrapperClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      selectClip(null);
    }
  }, [selectClip]);

  // ---- Derived state ----
  const hasTimelineClips = timelineClips.length > 0;

  const tracks = useEditorStore((s) => s.tracks);

  // All visible clips at current time (no type filter)
  const visibleClips = useMemo(
    () =>
      timelineClips
        .filter(
          (c) =>
            currentTime >= c.startTime &&
            currentTime < c.startTime + c.duration,
        )
        .sort((a, b) => {
          const ai = tracks.indexOf(a.track);
          const bi = tracks.indexOf(b.track);
          return bi - ai;
        }),
    [timelineClips, currentTime, tracks],
  );

  // Helper to look up MediaFile for a clip
  const getMediaFile = useCallback(
    (mediaPath: string) => mediaFiles.find((m) => m.path === mediaPath),
    [mediaFiles],
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
    if (!selectedClip) return { w: 0, h: 0 };
    const mediaFile = getMediaFile(selectedClip.mediaPath);
    const mediaType = mediaFile?.type ?? 'video';
    // Component and audio clips fill the container
    if (mediaType === 'component' || mediaType === 'audio') {
      return { w: wrapperSize.w, h: wrapperSize.h };
    }
    // Video clips use natural size
    const nat = naturalSizes[selectedClip.id];
    if (!nat) return { w: 0, h: 0 };
    return fitSize(nat.w, nat.h, wrapperSize.w, wrapperSize.h);
  }, [selectedClip, getMediaFile, naturalSizes, wrapperSize]);

  const setTransformProp = useCallback(
    (id: number, prop: AnimatableProp, value: number, localTime: number) => {
      const freshClip = useEditorStore.getState().timelineClips.find((c) => c.id === id);
      if (!freshClip) return;
      const kfs = freshClip.keyframes?.[prop];
      if (kfs && kfs.length > 0) {
        const existing = kfs.find((k) => Math.abs(k.time - localTime) < 0.02);
        if (existing) updateKeyframe(id, prop, existing.id, { value });
        else addKeyframe(id, prop, localTime, value, 'linear');
      } else {
        updateClip(id, { [prop]: value });
      }
    },
    [updateClip, addKeyframe, updateKeyframe],
  );

  const handleMoveDown = useCallback(
    (e: React.MouseEvent) => {
      if (!selectedClip) return;
      if ((e.target as HTMLElement).dataset.handle) return;
      e.preventDefault();
      e.stopPropagation();

      const startX = e.clientX;
      const startY = e.clientY;
      const clipLocalTime = currentTime - selectedClip.startTime;
      const anim = getAnimatedTransform(selectedClip, clipLocalTime);
      const origX = anim.x;
      const origY = anim.y;
      const base = getSelectedBase();
      if (!base.w) return;
      const id = selectedClip.id;

      const onMove = (ev: MouseEvent) => {
        setTransformProp(id, 'x', origX + (ev.clientX - startX) / base.w, clipLocalTime);
        setTransformProp(id, 'y', origY + (ev.clientY - startY) / base.h, clipLocalTime);
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [selectedClip, currentTime, getSelectedBase, setTransformProp],
  );

  // ---- Transform: corner resize (uniform scale) ----
  const handleCornerResizeDown = useCallback(
    (e: React.MouseEvent, dir: CornerDir) => {
      if (!selectedClip) return;
      e.preventDefault();
      e.stopPropagation();

      const startX = e.clientX;
      const startY = e.clientY;
      const clipLocalTime = currentTime - selectedClip.startTime;
      const anim = getAnimatedTransform(selectedClip, clipLocalTime);
      const origScale = anim.scale;
      const origXPos = anim.x;
      const origYPos = anim.y;
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
        setTransformProp(id, 'scale', newScale, clipLocalTime);
        setTransformProp(id, 'x', origXPos + (dir === 'nw' || dir === 'sw' ? dScale * 0.5 : -dScale * 0.5), clipLocalTime);
        setTransformProp(id, 'y', origYPos + (dir === 'nw' || dir === 'ne' ? dScale * 0.5 : -dScale * 0.5), clipLocalTime);
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [selectedClip, currentTime, getSelectedBase, setTransformProp],
  );

  // ---- Transform: edge resize (non-uniform scaleX / scaleY) ----
  const handleEdgeResizeDown = useCallback(
    (e: React.MouseEvent, dir: EdgeDir) => {
      if (!selectedClip) return;
      e.preventDefault();
      e.stopPropagation();

      const startX = e.clientX;
      const startY = e.clientY;
      const clipLocalTime = currentTime - selectedClip.startTime;
      const anim = getAnimatedTransform(selectedClip, clipLocalTime);
      const origScaleX = anim.scaleX;
      const origScaleY = anim.scaleY;
      const origXPos = anim.x;
      const origYPos = anim.y;
      const base = getSelectedBase();
      if (!base.w) return;
      const id = selectedClip.id;
      const effectiveW = base.w * anim.scale;
      const effectiveH = base.h * anim.scale;

      const onMove = (ev: MouseEvent) => {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;

        if (dir === 'e' || dir === 'w') {
          const sign = dir === 'w' ? -1 : 1;
          const newSX = Math.max(0.1, origScaleX + (dx * sign) / (effectiveW * 0.5));
          const dSX = newSX - origScaleX;
          setTransformProp(id, 'scaleX', newSX, clipLocalTime);
          setTransformProp(id, 'x', origXPos + (dir === 'w' ? dSX * anim.scale * 0.5 : -dSX * anim.scale * 0.5), clipLocalTime);
        } else {
          const sign = dir === 'n' ? -1 : 1;
          const newSY = Math.max(0.1, origScaleY + (dy * sign) / (effectiveH * 0.5));
          const dSY = newSY - origScaleY;
          setTransformProp(id, 'scaleY', newSY, clipLocalTime);
          setTransformProp(id, 'y', origYPos + (dir === 'n' ? dSY * anim.scale * 0.5 : -dSY * anim.scale * 0.5), clipLocalTime);
        }
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [selectedClip, currentTime, getSelectedBase, setTransformProp],
  );

  // ---- Mask: set property (keyframe-aware, writes to clip.mask) ----
  const setMaskProp = useCallback(
    (id: number, prop: AnimatableProp, maskKey: string, value: number, localTime: number) => {
      const freshClip = useEditorStore.getState().timelineClips.find((c) => c.id === id);
      if (!freshClip?.mask) return;
      const kfs = freshClip.keyframes?.[prop];
      if (kfs && kfs.length > 0) {
        const existing = kfs.find((k) => Math.abs(k.time - localTime) < 0.02);
        if (existing) updateKeyframe(id, prop, existing.id, { value });
        else addKeyframe(id, prop, localTime, value, 'linear');
      } else {
        updateClip(id, { mask: { ...freshClip.mask, [maskKey]: value } });
      }
    },
    [updateClip, addKeyframe, updateKeyframe],
  );

  // ---- Mask: move (drag mask center) ----
  const handleMaskMoveDown = useCallback(
    (e: React.MouseEvent) => {
      if (!selectedClip?.mask) return;
      if ((e.target as HTMLElement).dataset.maskhandle) return;
      e.preventDefault();
      e.stopPropagation();

      const startX = e.clientX;
      const startY = e.clientY;
      const clipLocalTime = currentTime - selectedClip.startTime;
      const mask = getAnimatedMask(selectedClip, clipLocalTime);
      if (!mask) return;
      const origCX = mask.centerX;
      const origCY = mask.centerY;
      const id = selectedClip.id;

      const base = getSelectedBase();
      if (!base.w) return;
      const anim = getAnimatedTransform(selectedClip, clipLocalTime);
      const boxW = base.w * anim.scale * anim.scaleX;
      const boxH = base.h * anim.scale * anim.scaleY;

      const onMove = (ev: MouseEvent) => {
        const dx = (ev.clientX - startX) / boxW;
        const dy = (ev.clientY - startY) / boxH;
        setMaskProp(id, 'maskCenterX', 'centerX', origCX + dx, clipLocalTime);
        setMaskProp(id, 'maskCenterY', 'centerY', origCY + dy, clipLocalTime);
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [selectedClip, currentTime, getSelectedBase, setMaskProp],
  );

  // ---- Mask: edge resize ----
  const handleMaskEdgeDown = useCallback(
    (e: React.MouseEvent, dir: EdgeDir) => {
      if (!selectedClip?.mask) return;
      e.preventDefault();
      e.stopPropagation();

      const startX = e.clientX;
      const startY = e.clientY;
      const clipLocalTime = currentTime - selectedClip.startTime;
      const mask = getAnimatedMask(selectedClip, clipLocalTime);
      if (!mask) return;
      const origW = mask.width;
      const origH = mask.height;
      const origCX = mask.centerX;
      const origCY = mask.centerY;
      const id = selectedClip.id;

      const base = getSelectedBase();
      if (!base.w) return;
      const anim = getAnimatedTransform(selectedClip, clipLocalTime);
      const boxW = base.w * anim.scale * anim.scaleX;
      const boxH = base.h * anim.scale * anim.scaleY;

      const onMove = (ev: MouseEvent) => {
        const dx = (ev.clientX - startX) / boxW;
        const dy = (ev.clientY - startY) / boxH;

        if (dir === 'e') {
          const newW = Math.max(0.01, origW + dx);
          setMaskProp(id, 'maskWidth', 'width', newW, clipLocalTime);
          setMaskProp(id, 'maskCenterX', 'centerX', origCX + dx / 2, clipLocalTime);
        } else if (dir === 'w') {
          const newW = Math.max(0.01, origW - dx);
          setMaskProp(id, 'maskWidth', 'width', newW, clipLocalTime);
          setMaskProp(id, 'maskCenterX', 'centerX', origCX + dx / 2, clipLocalTime);
        } else if (dir === 's') {
          const newH = Math.max(0.01, origH + dy);
          setMaskProp(id, 'maskHeight', 'height', newH, clipLocalTime);
          setMaskProp(id, 'maskCenterY', 'centerY', origCY + dy / 2, clipLocalTime);
        } else {
          const newH = Math.max(0.01, origH - dy);
          setMaskProp(id, 'maskHeight', 'height', newH, clipLocalTime);
          setMaskProp(id, 'maskCenterY', 'centerY', origCY + dy / 2, clipLocalTime);
        }
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [selectedClip, currentTime, getSelectedBase, setMaskProp],
  );

  // ---- Mask: corner resize (both width + height) ----
  const handleMaskCornerDown = useCallback(
    (e: React.MouseEvent, dir: CornerDir) => {
      if (!selectedClip?.mask) return;
      e.preventDefault();
      e.stopPropagation();

      const startX = e.clientX;
      const startY = e.clientY;
      const clipLocalTime = currentTime - selectedClip.startTime;
      const mask = getAnimatedMask(selectedClip, clipLocalTime);
      if (!mask) return;
      const origW = mask.width;
      const origH = mask.height;
      const origCX = mask.centerX;
      const origCY = mask.centerY;
      const id = selectedClip.id;

      const base = getSelectedBase();
      if (!base.w) return;
      const anim = getAnimatedTransform(selectedClip, clipLocalTime);
      const boxW = base.w * anim.scale * anim.scaleX;
      const boxH = base.h * anim.scale * anim.scaleY;

      const onMove = (ev: MouseEvent) => {
        const dx = (ev.clientX - startX) / boxW;
        const dy = (ev.clientY - startY) / boxH;
        const signX = dir === 'nw' || dir === 'sw' ? -1 : 1;
        const signY = dir === 'nw' || dir === 'ne' ? -1 : 1;

        const newW = Math.max(0.01, origW + dx * signX);
        const newH = Math.max(0.01, origH + dy * signY);
        setMaskProp(id, 'maskWidth', 'width', newW, clipLocalTime);
        setMaskProp(id, 'maskHeight', 'height', newH, clipLocalTime);
        setMaskProp(id, 'maskCenterX', 'centerX', origCX + dx / 2, clipLocalTime);
        setMaskProp(id, 'maskCenterY', 'centerY', origCY + dy / 2, clipLocalTime);
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [selectedClip, currentTime, getSelectedBase, setMaskProp],
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

  // ---- Handle overlay ----
  const showHandles =
    selectedClip &&
    visibleClips.some((c) => c.id === selectedClip.id);

  let handleStyle: React.CSSProperties | undefined;
  let selectedMask: ClipMask | null = null;
  if (showHandles && selectedClip) {
    const base = getSelectedBase();
    if (base.w > 0) {
      const clipLocalTime = currentTime - selectedClip.startTime;
      const anim = getAnimatedTransform(selectedClip, clipLocalTime);
      handleStyle = makeTransformStyle(
        anim.x,
        anim.y,
        anim.scale,
        base.w,
        base.h,
        anim.scaleX,
        anim.scaleY,
      );
      selectedMask = getAnimatedMask(selectedClip, clipLocalTime);
    }
  }

  // ---- Render ----
  return (
    <div className="preview-container">
      <div className="preview-wrapper" ref={wrapperRef} onMouseDown={handleWrapperClick}>
        {/* Timeline composite: one ClipLayer per visible clip */}
        {hasTimelineClips &&
          visibleClips.map((clip) => {
            const mediaFile = getMediaFile(clip.mediaPath);
            const mediaType = mediaFile?.type ?? 'video';
            const clipLocalTime = currentTime - clip.startTime;
            const { x, y, scale, scaleX, scaleY } = getAnimatedTransform(clip, clipLocalTime);
            const animMask = getAnimatedMask(clip, clipLocalTime);

            // For video clips, use natural size; for others, use wrapper size
            const nat = naturalSizes[clip.id];
            const base = (mediaType === 'video' && nat)
              ? fitSize(nat.w, nat.h, wrapperSize.w, wrapperSize.h)
              : { w: wrapperSize.w, h: wrapperSize.h };

            const style: React.CSSProperties =
              base.w > 0
                ? {
                    ...makeTransformStyle(x, y, scale, base.w, base.h, scaleX, scaleY),
                    overflow: 'hidden',
                    ...(animMask ? { clipPath: buildClipPath(animMask) } : {}),
                    ...(animMask && animMask.feather > 0 ? { filter: `blur(${animMask.feather}px)` } : {}),
                  }
                : { position: 'absolute', opacity: 0, pointerEvents: 'none' };

            return (
              <div key={clip.id} style={style}>
                <ClipLayer
                  clip={clip}
                  mediaFile={mediaFile}
                  globalTime={currentTime}
                  isPlaying={isPlaying}
                  containerW={base.w * scale * scaleX}
                  containerH={base.h * scale * scaleY}
                  onNaturalSize={handleNaturalSize}
                  onSelect={handleSelectClip}
                />
              </div>
            );
          })}

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
            {CORNER_DIRS.map((dir) => (
              <div
                key={dir}
                className={`canvas-handle canvas-handle-${dir}`}
                data-handle="1"
                onMouseDown={(e) => handleCornerResizeDown(e, dir)}
              />
            ))}
            {EDGE_DIRS.map((dir) => (
              <div
                key={dir}
                className={`canvas-edge-handle canvas-edge-handle-${dir}`}
                data-handle="1"
                onMouseDown={(e) => handleEdgeResizeDown(e, dir)}
              />
            ))}
            {selectedMask && (
              <div
                className="mask-interact-box"
                style={{
                  left: `${(selectedMask.centerX - selectedMask.width / 2) * 100}%`,
                  top: `${(selectedMask.centerY - selectedMask.height / 2) * 100}%`,
                  width: `${selectedMask.width * 100}%`,
                  height: `${selectedMask.height * 100}%`,
                  borderRadius: selectedMask.shape === 'ellipse' ? '50%' : `${selectedMask.borderRadius * Math.min(selectedMask.width, selectedMask.height) * 100}%`,
                }}
                onMouseDown={handleMaskMoveDown}
              >
                {CORNER_DIRS.map((dir) => (
                  <div
                    key={dir}
                    className={`mask-handle mask-handle-${dir}`}
                    data-maskhandle="1"
                    onMouseDown={(e) => handleMaskCornerDown(e, dir)}
                  />
                ))}
                {EDGE_DIRS.map((dir) => (
                  <div
                    key={dir}
                    className={`mask-edge-handle mask-edge-handle-${dir}`}
                    data-maskhandle="1"
                    onMouseDown={(e) => handleMaskEdgeDown(e, dir)}
                  />
                ))}
              </div>
            )}
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
