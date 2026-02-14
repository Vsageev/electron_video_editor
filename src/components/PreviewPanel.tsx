import { useRef, useEffect, useCallback, useState, useMemo } from 'react';
import { useEditorStore } from '../store/editorStore';
import { formatTime } from '../utils/formatTime';
import { filePathToFileUrl } from '../utils/fileUrl';
import { getAnimatedTransform, getAnimatedMask } from '../utils/keyframeEngine';
import ClipLayer from './ClipLayer';
import Tooltip from './Tooltip';
import type { AnimatableProp, ClipMask } from '../types';

type CornerDir = 'nw' | 'ne' | 'sw' | 'se';
type EdgeDir = 'n' | 's' | 'e' | 'w';
const CORNER_DIRS: CornerDir[] = ['nw', 'ne', 'sw', 'se'];
const EDGE_DIRS: EdgeDir[] = ['n', 's', 'e', 'w'];

const ASPECT_RATIO_PRESETS = [
  { label: '16:9',  w: 16, h: 9  },
  { label: '9:16',  w: 9,  h: 16 },
  { label: '1:1',   w: 1,  h: 1  },
  { label: '4:3',   w: 4,  h: 3  },
  { label: '4:5',   w: 4,  h: 5  },
];

function roundEven(n: number) {
  return Math.round(n / 2) * 2;
}

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
  rotation = 0,
  flipX = false,
  flipY = false,
): React.CSSProperties {
  let transform = `translate(calc(-50% + ${x * bw}px), calc(-50% + ${y * bh}px))`;
  if (rotation) transform += ` rotate(${rotation}deg)`;
  if (flipX || flipY) transform += ` scale(${flipX ? -1 : 1}, ${flipY ? -1 : 1})`;
  return {
    position: 'absolute',
    width: bw * scale * sX,
    height: bh * scale * sY,
    left: '50%',
    top: '50%',
    transform,
  };
}

function buildClipPath(mask: ClipMask, elW?: number, elH?: number): string {
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
  // Compute aspect-ratio-corrected radius so corners are circular on non-square elements.
  // CSS inset() round resolves % against element width (horizontal) and height (vertical),
  // so we need separate values to get the same pixel radius in both directions.
  let rStr = '';
  if (mask.borderRadius > 0) {
    if (elW && elH && elW > 0 && elH > 0) {
      const hwPx = (mask.width / 2) * elW;
      const hhPx = (mask.height / 2) * elH;
      const rPx = mask.borderRadius * Math.min(hwPx, hhPx) * 2;
      const rH = (rPx / elW) * 100;
      const rV = (rPx / elH) * 100;
      rStr = ` round ${rH}% / ${rV}%`;
    } else {
      const r = mask.borderRadius * Math.min(hw, hh) * 2;
      rStr = ` round ${r}%`;
    }
  }

  if (!mask.invert) {
    return `inset(${top}% ${right}% ${bottom}% ${left}%${rStr})`;
  }
  const l = left;
  const t = top;
  const rr = 100 - right;
  const bb = 100 - bottom;
  return `polygon(evenodd, 0% 0%, 100% 0%, 100% 100%, 0% 100%, 0% 0%, ${l}% ${t}%, ${rr}% ${t}%, ${rr}% ${bb}%, ${l}% ${bb}%, ${l}% ${t}%)`;
}

/**
 * Build an SVG data-URI mask-image for feathered masks.
 * Uses pixel-space coordinates (viewBox matches element size) so shapes and blur
 * are aspect-ratio independent — no distortion on non-square elements.
 */
function buildFeatheredMaskStyle(mask: ClipMask, elW: number, elH: number): React.CSSProperties {
  if (elW <= 0 || elH <= 0) return { clipPath: buildClipPath(mask, elW, elH) };

  // All coordinates in pixels
  const cx = mask.centerX * elW;
  const cy = mask.centerY * elH;
  const hw = (mask.width / 2) * elW;
  const hh = (mask.height / 2) * elH;
  const feather = mask.feather;
  // Expand filter region beyond shape bounds to accommodate blur bleed
  const pad = feather * 3;

  let shapeEl: string;
  if (mask.shape === 'ellipse') {
    shapeEl = `<ellipse cx="${cx}" cy="${cy}" rx="${hw}" ry="${hh}" fill="white"/>`;
  } else {
    // borderRadius is 0–0.5 fraction of the smaller mask dimension (in pixels)
    const r = mask.borderRadius * Math.min(hw, hh) * 2;
    shapeEl = `<rect x="${cx - hw}" y="${cy - hh}" width="${hw * 2}" height="${hh * 2}" rx="${r}" ry="${r}" fill="white"/>`;
  }

  let maskContent: string;
  if (mask.invert) {
    maskContent = `<rect width="${elW}" height="${elH}" fill="white"/><g filter="url(%23feather)">${shapeEl.replace('fill="white"', 'fill="black"')}</g>`;
  } else {
    maskContent = `<g filter="url(%23feather)">${shapeEl}</g>`;
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${elW} ${elH}">`
    + `<defs>`
    + `<filter id="feather" x="${-pad}" y="${-pad}" width="${elW + pad * 2}" height="${elH + pad * 2}" filterUnits="userSpaceOnUse">`
    + `<feGaussianBlur stdDeviation="${feather}"/>`
    + `</filter>`
    + `</defs>`
    + `<mask id="m">${maskContent}</mask>`
    + `<rect width="${elW}" height="${elH}" mask="url(%23m)" fill="white"/>`
    + `</svg>`;

  const encoded = `url("data:image/svg+xml,${svg}")`;
  return {
    WebkitMaskImage: encoded,
    maskImage: encoded,
    WebkitMaskSize: '100% 100%',
    maskSize: '100% 100%',
  } as React.CSSProperties;
}

/** Returns mask-related CSS props for a clip: clip-path for hard masks, SVG mask-image for feathered. */
function buildMaskStyle(mask: ClipMask, elW: number, elH: number): React.CSSProperties {
  if (mask.feather > 0) {
    return buildFeatheredMaskStyle(mask, elW, elH);
  }
  return { clipPath: buildClipPath(mask, elW, elH) };
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
  const selectedClipIds = useEditorStore((s) => s.selectedClipIds);
  const selectedClip = useEditorStore((s) => {
    if (s.selectedClipIds.length !== 1) return null;
    return s.timelineClips.find((c) => c.id === s.selectedClipIds[0]) ?? null;
  });
  const currentTime = useEditorStore((s) => s.currentTime);
  const isPlaying = useEditorStore((s) => s.isPlaying);
  const duration = useEditorStore((s) => s.duration);
  const previewMediaPath = useEditorStore((s) => s.previewMediaPath);
  const previewMediaType = useEditorStore((s) => s.previewMediaType);
  const updateClip = useEditorStore((s) => s.updateClip);
  const addKeyframe = useEditorStore((s) => s.addKeyframe);
  const updateKeyframe = useEditorStore((s) => s.updateKeyframe);
  const beginUndoBatch = useEditorStore((s) => s.beginUndoBatch);
  const endUndoBatch = useEditorStore((s) => s.endUndoBatch);
  const setCurrentTime = useEditorStore((s) => s.setCurrentTime);
  const setIsPlaying = useEditorStore((s) => s.setIsPlaying);
  const setDuration = useEditorStore((s) => s.setDuration);
  const canvasZoom = useEditorStore((s) => s.canvasZoom);
  const canvasPanX = useEditorStore((s) => s.canvasPanX);
  const canvasPanY = useEditorStore((s) => s.canvasPanY);
  const setCanvasZoom = useEditorStore((s) => s.setCanvasZoom);
  const setCanvasPan = useEditorStore((s) => s.setCanvasPan);
  const resetCanvasView = useEditorStore((s) => s.resetCanvasView);
  const exportSettings = useEditorStore((s) => s.exportSettings);
  const maskEditActive = useEditorStore((s) => s.maskEditActive);
  const setExportSettings = useEditorStore((s) => s.setExportSettings);

  // ---- Aspect ratio ----
  const currentAspectIdx = useMemo(() => {
    const ratio = exportSettings.width / exportSettings.height;
    const idx = ASPECT_RATIO_PRESETS.findIndex(
      (p) => Math.abs(p.w / p.h - ratio) < 0.01,
    );
    return idx;
  }, [exportSettings.width, exportSettings.height]);

  const handleAspectChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const preset = ASPECT_RATIO_PRESETS[Number(e.target.value)];
      if (!preset) return;
      const maxDim = Math.max(exportSettings.width, exportSettings.height);
      let w: number;
      let h: number;
      if (preset.w >= preset.h) {
        h = roundEven(maxDim * (preset.h / preset.w));
        w = maxDim;
      } else {
        w = roundEven(maxDim * (preset.w / preset.h));
        h = maxDim;
      }
      setExportSettings({ width: w, height: h });
    },
    [exportSettings.width, exportSettings.height, setExportSettings],
  );

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

  // ---- Canvas rect sized to export aspect ratio, fit inside wrapper ----
  const CANVAS_PADDING = 32;
  const canvasSize = useMemo(() => {
    const availW = wrapperSize.w - CANVAS_PADDING * 2;
    const availH = wrapperSize.h - CANVAS_PADDING * 2;
    if (availW <= 0 || availH <= 0) return { w: 0, h: 0 };
    return fitSize(exportSettings.width, exportSettings.height, availW, availH);
  }, [wrapperSize, exportSettings.width, exportSettings.height]);

  // Natural-size callback from ClipLayers
  const handleNaturalSize = useCallback((id: number, w: number, h: number) => {
    setNaturalSizes((prev) => ({ ...prev, [id]: { w, h } }));
  }, []);

  const handleSelectClip = useCallback((id: number, e?: { ctrlKey?: boolean; metaKey?: boolean }) => {
    if (e && (e.ctrlKey || e.metaKey)) {
      selectClip(id, { toggle: true });
    } else {
      selectClip(id);
    }
  }, [selectClip]);

  const handleWrapperClick = useCallback((e: React.MouseEvent) => {
    const el = e.target as HTMLElement;
    if (
      e.target === e.currentTarget ||
      el.classList.contains('canvas-zoom-layer') ||
      el.classList.contains('canvas-rect')
    ) {
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

  const showStandaloneVideo =
    !!previewMediaPath && previewMediaType === 'video';
  const showStandaloneImage =
    !!previewMediaPath && previewMediaType === 'image';
  const showStandalone = showStandaloneVideo || showStandaloneImage;
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
    if (!showStandaloneVideo) return;
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
  }, [showStandaloneVideo, setDuration, setCurrentTime, setIsPlaying]);

  useEffect(() => {
    if (!showStandaloneVideo) return;
    const v = standaloneRef.current;
    if (!v) return;
    if (isPlaying) v.play().catch(() => {});
    else v.pause();
  }, [isPlaying, showStandaloneVideo]);

  useEffect(() => {
    if (!showStandaloneVideo) return;
    if (isSeekedByStandalone.current) {
      isSeekedByStandalone.current = false;
      return;
    }
    const v = standaloneRef.current;
    if (!v || !v.readyState) return;
    if (Math.abs(v.currentTime - currentTime) > 0.05) {
      v.currentTime = currentTime;
    }
  }, [currentTime, showStandaloneVideo]);

  // ---- Helper: get base size for any clip ----
  const getClipBase = useCallback((clip: typeof timelineClips[0]) => {
    const mediaFile = getMediaFile(clip.mediaPath);
    const mediaType = mediaFile?.type ?? 'video';
    if (mediaType === 'component' || mediaType === 'audio') {
      return { w: canvasSize.w, h: canvasSize.h };
    }
    const nat = naturalSizes[clip.id];
    if (!nat) return { w: 0, h: 0 };
    return fitSize(nat.w, nat.h, canvasSize.w, canvasSize.h);
  }, [getMediaFile, naturalSizes, canvasSize]);

  const getSelectedBase = useCallback(() => {
    if (!selectedClip) return { w: 0, h: 0 };
    return getClipBase(selectedClip);
  }, [selectedClip, getClipBase]);

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

  // ---- Snapshot selected visible clips for group transforms ----
  type ClipSnapshot = {
    clip: typeof timelineClips[0];
    base: { w: number; h: number };
    anim: ReturnType<typeof getAnimatedTransform>;
    clipLocalTime: number;
    px: number; // pixel center x
    py: number; // pixel center y
  };

  const snapshotSelectedVisible = useCallback((): { snapshots: ClipSnapshot[]; gcx: number; gcy: number } | null => {
    const ids = useEditorStore.getState().selectedClipIds;
    const ct = useEditorStore.getState().currentTime;
    const snapshots: ClipSnapshot[] = [];
    for (const vc of visibleClips) {
      if (!ids.includes(vc.id)) continue;
      const base = getClipBase(vc);
      if (!base.w) continue;
      const clt = ct - vc.startTime;
      const anim = getAnimatedTransform(vc, clt);
      const px = canvasSize.w / 2 + anim.x * base.w;
      const py = canvasSize.h / 2 + anim.y * base.h;
      snapshots.push({ clip: vc, base, anim, clipLocalTime: clt, px, py });
    }
    if (snapshots.length === 0) return null;
    // Group center
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const s of snapshots) {
      const hw = s.base.w * s.anim.scale * s.anim.scaleX / 2;
      const hh = s.base.h * s.anim.scale * s.anim.scaleY / 2;
      const rad = (s.anim.rotation || 0) * Math.PI / 180;
      const cos = Math.cos(rad), sin = Math.sin(rad);
      for (const [cx, cy] of [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]]) {
        const rx = s.px + cx * cos - cy * sin;
        const ry = s.py + cx * sin + cy * cos;
        if (rx < minX) minX = rx;
        if (rx > maxX) maxX = rx;
        if (ry < minY) minY = ry;
        if (ry > maxY) maxY = ry;
      }
    }
    return { snapshots, gcx: (minX + maxX) / 2, gcy: (minY + maxY) / 2 };
  }, [visibleClips, getClipBase, canvasSize]);

  // ---- Transform: move (group-aware) ----
  const handleMoveDown = useCallback(
    (e: React.MouseEvent) => {
      if (selectedClipIds.length === 0) return;
      if ((e.target as HTMLElement).dataset.handle) return;
      e.preventDefault();
      e.stopPropagation();

      const snap = snapshotSelectedVisible();
      if (!snap) return;
      const startX = e.clientX;
      const startY = e.clientY;
      beginUndoBatch();

      const onMove = (ev: MouseEvent) => {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        for (const s of snap.snapshots) {
          setTransformProp(s.clip.id, 'x', s.anim.x + dx / s.base.w, s.clipLocalTime);
          setTransformProp(s.clip.id, 'y', s.anim.y + dy / s.base.h, s.clipLocalTime);
        }
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        endUndoBatch();
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [selectedClipIds, snapshotSelectedVisible, setTransformProp, beginUndoBatch, endUndoBatch],
  );

  // ---- Transform: corner resize (uniform scale, group-aware) ----
  const handleCornerResizeDown = useCallback(
    (e: React.MouseEvent, dir: CornerDir) => {
      if (selectedClipIds.length === 0) return;
      e.preventDefault();
      e.stopPropagation();

      const snap = snapshotSelectedVisible();
      if (!snap) return;
      const startX = e.clientX;
      const startY = e.clientY;
      const isSingle = snap.snapshots.length === 1;
      // For single clip, use first clip's base for scale sensitivity
      const refW = isSingle ? snap.snapshots[0].base.w : (
        (() => {
          let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
          for (const s of snap.snapshots) {
            const hw = s.base.w * s.anim.scale * s.anim.scaleX / 2;
            const hh = s.base.h * s.anim.scale * s.anim.scaleY / 2;
            minX = Math.min(minX, s.px - hw); maxX = Math.max(maxX, s.px + hw);
            minY = Math.min(minY, s.py - hh); maxY = Math.max(maxY, s.py + hh);
          }
          return Math.max(1, maxX - minX);
        })()
      );
      beginUndoBatch();

      const onMove = (ev: MouseEvent) => {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        const signX = dir === 'nw' || dir === 'sw' ? -1 : 1;
        const signY = dir === 'nw' || dir === 'ne' ? -1 : 1;
        const delta = (dx * signX + dy * signY) / 2;
        const sRatio = Math.max(0.1, 1 + delta / (refW * 0.5));

        for (const s of snap.snapshots) {
          const newScale = Math.max(0.1, s.anim.scale * sRatio);
          setTransformProp(s.clip.id, 'scale', newScale, s.clipLocalTime);
          // Reposition: scale distance from group center
          const newPx = snap.gcx + (s.px - snap.gcx) * sRatio;
          const newPy = snap.gcy + (s.py - snap.gcy) * sRatio;
          setTransformProp(s.clip.id, 'x', (newPx - canvasSize.w / 2) / s.base.w, s.clipLocalTime);
          setTransformProp(s.clip.id, 'y', (newPy - canvasSize.h / 2) / s.base.h, s.clipLocalTime);
        }
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        endUndoBatch();
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [selectedClipIds, snapshotSelectedVisible, setTransformProp, canvasSize, beginUndoBatch, endUndoBatch],
  );

  // ---- Transform: edge resize (non-uniform scaleX / scaleY) — single clip only ----
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
      beginUndoBatch();

      const onMove = (ev: MouseEvent) => {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;

        if (dir === 'e' || dir === 'w') {
          const sign = dir === 'w' ? -1 : 1;
          const newSX = Math.max(0.1, origScaleX + (dx * sign) / (effectiveW * 0.5));
          const dSX = newSX - origScaleX;
          setTransformProp(id, 'scaleX', newSX, clipLocalTime);
          setTransformProp(id, 'x', origXPos + (dir === 'e' ? dSX * anim.scale * 0.5 : -dSX * anim.scale * 0.5), clipLocalTime);
        } else {
          const sign = dir === 'n' ? -1 : 1;
          const newSY = Math.max(0.1, origScaleY + (dy * sign) / (effectiveH * 0.5));
          const dSY = newSY - origScaleY;
          setTransformProp(id, 'scaleY', newSY, clipLocalTime);
          setTransformProp(id, 'y', origYPos + (dir === 's' ? dSY * anim.scale * 0.5 : -dSY * anim.scale * 0.5), clipLocalTime);
        }
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        endUndoBatch();
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [selectedClip, currentTime, getSelectedBase, setTransformProp, beginUndoBatch, endUndoBatch],
  );

  // ---- Transform: rotation handle (group-aware) ----
  const handleRotationDown = useCallback(
    (e: React.MouseEvent) => {
      if (selectedClipIds.length === 0) return;
      e.preventDefault();
      e.stopPropagation();

      const snap = snapshotSelectedVisible();
      if (!snap) return;

      const box = (e.target as HTMLElement).closest('.canvas-transform-box') || (e.target as HTMLElement).closest('.canvas-group-box');
      if (!box) return;
      const rect = box.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const startAngle = Math.atan2(e.clientY - centerY, e.clientX - centerX) * (180 / Math.PI);
      beginUndoBatch();

      const onMove = (ev: MouseEvent) => {
        const angle = Math.atan2(ev.clientY - centerY, ev.clientX - centerX) * (180 / Math.PI);
        let dTheta = angle - startAngle;
        if (ev.shiftKey) {
          dTheta = Math.round(dTheta / 15) * 15;
        }
        const dRad = dTheta * Math.PI / 180;
        const cosD = Math.cos(dRad), sinD = Math.sin(dRad);

        for (const s of snap.snapshots) {
          // Orbit position around group center
          const relX = s.px - snap.gcx;
          const relY = s.py - snap.gcy;
          const newRelX = relX * cosD - relY * sinD;
          const newRelY = relX * sinD + relY * cosD;
          setTransformProp(s.clip.id, 'x', (snap.gcx + newRelX - canvasSize.w / 2) / s.base.w, s.clipLocalTime);
          setTransformProp(s.clip.id, 'y', (snap.gcy + newRelY - canvasSize.h / 2) / s.base.h, s.clipLocalTime);
          setTransformProp(s.clip.id, 'rotation', s.anim.rotation + dTheta, s.clipLocalTime);
        }
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        endUndoBatch();
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [selectedClipIds, snapshotSelectedVisible, setTransformProp, canvasSize, beginUndoBatch, endUndoBatch],
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
      beginUndoBatch();

      const onMove = (ev: MouseEvent) => {
        const dx = (ev.clientX - startX) / boxW;
        const dy = (ev.clientY - startY) / boxH;
        setMaskProp(id, 'maskCenterX', 'centerX', origCX + dx, clipLocalTime);
        setMaskProp(id, 'maskCenterY', 'centerY', origCY + dy, clipLocalTime);
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        endUndoBatch();
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [selectedClip, currentTime, getSelectedBase, setMaskProp, beginUndoBatch, endUndoBatch],
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
      beginUndoBatch();

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
        endUndoBatch();
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [selectedClip, currentTime, getSelectedBase, setMaskProp, beginUndoBatch, endUndoBatch],
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
      beginUndoBatch();

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
        endUndoBatch();
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [selectedClip, currentTime, getSelectedBase, setMaskProp, beginUndoBatch, endUndoBatch],
  );

  // ---- Canvas zoom (Ctrl/Cmd+wheel) & pan (scroll / middle-click / space+drag) ----
  const handleCanvasWheel = useCallback(
    (e: React.WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        // Zoom toward cursor
        e.preventDefault();
        const state = useEditorStore.getState();
        const oldZoom = state.canvasZoom;
        const delta = -e.deltaY * 0.002;
        const newZoom = Math.max(0.1, Math.min(5, oldZoom + delta * oldZoom));

        const rect = wrapperRef.current?.getBoundingClientRect();
        if (rect) {
          const cx = e.clientX - rect.left - rect.width / 2;
          const cy = e.clientY - rect.top - rect.height / 2;
          const scale = newZoom / oldZoom;
          const newPanX = cx - scale * (cx - state.canvasPanX);
          const newPanY = cy - scale * (cy - state.canvasPanY);
          setCanvasPan(newPanX, newPanY);
        }
        setCanvasZoom(newZoom);
      } else {
        // Pan with scroll
        e.preventDefault();
        const state = useEditorStore.getState();
        setCanvasPan(state.canvasPanX - e.deltaX, state.canvasPanY - e.deltaY);
      }
    },
    [setCanvasZoom, setCanvasPan],
  );

  const spaceHeld = useRef(false);
  useEffect(() => {
    const onDown = (e: KeyboardEvent) => { if (e.code === 'Space' && !e.repeat) spaceHeld.current = true; };
    const onUp = (e: KeyboardEvent) => { if (e.code === 'Space') spaceHeld.current = false; };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    return () => { window.removeEventListener('keydown', onDown); window.removeEventListener('keyup', onUp); };
  }, []);

  const handleCanvasPanDown = useCallback(
    (e: React.MouseEvent) => {
      // Middle mouse button or space+left click
      if (e.button !== 1 && !(spaceHeld.current && e.button === 0)) return;
      e.preventDefault();
      const startX = e.clientX;
      const startY = e.clientY;
      const state = useEditorStore.getState();
      const origPanX = state.canvasPanX;
      const origPanY = state.canvasPanY;

      const onMove = (ev: MouseEvent) => {
        setCanvasPan(origPanX + (ev.clientX - startX), origPanY + (ev.clientY - startY));
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [setCanvasPan],
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
  const isMultiSelect = selectedClipIds.length > 1;
  const showSingleHandles =
    selectedClip &&
    !isMultiSelect &&
    !showStandalone &&
    visibleClips.some((c) => c.id === selectedClip.id);

  // Selected visible clips for group box
  const selectedVisibleClips = useMemo(() => {
    if (selectedClipIds.length === 0) return [];
    const idSet = new Set(selectedClipIds);
    return visibleClips.filter((c) => idSet.has(c.id));
  }, [selectedClipIds, visibleClips]);
  const showGroupBox = isMultiSelect && selectedVisibleClips.length >= 2;

  let handleStyle: React.CSSProperties | undefined;
  let selectedMask: ClipMask | null = null;
  let handleBoxW = 0;
  let handleBoxH = 0;
  if (showSingleHandles && selectedClip) {
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
        anim.rotation,
      );
      handleBoxW = base.w * anim.scale * anim.scaleX;
      handleBoxH = base.h * anim.scale * anim.scaleY;
      if (maskEditActive) {
        selectedMask = getAnimatedMask(selectedClip, clipLocalTime);
      }
    }
  }

  // Group bounding box (AABB) for multi-select
  const groupBoxStyle = useMemo((): React.CSSProperties | null => {
    if (!showGroupBox) return null;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const vc of selectedVisibleClips) {
      const base = getClipBase(vc);
      if (!base.w) continue;
      const clt = currentTime - vc.startTime;
      const anim = getAnimatedTransform(vc, clt);
      const px = canvasSize.w / 2 + anim.x * base.w;
      const py = canvasSize.h / 2 + anim.y * base.h;
      const hw = base.w * anim.scale * anim.scaleX / 2;
      const hh = base.h * anim.scale * anim.scaleY / 2;
      const rad = (anim.rotation || 0) * Math.PI / 180;
      const cos = Math.cos(rad), sin = Math.sin(rad);
      for (const [cx, cy] of [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]]) {
        const rx = px + cx * cos - cy * sin;
        const ry = py + cx * sin + cy * cos;
        if (rx < minX) minX = rx;
        if (rx > maxX) maxX = rx;
        if (ry < minY) minY = ry;
        if (ry > maxY) maxY = ry;
      }
    }
    if (!isFinite(minX)) return null;
    return {
      position: 'absolute',
      left: minX,
      top: minY,
      width: maxX - minX,
      height: maxY - minY,
    };
  }, [showGroupBox, selectedVisibleClips, currentTime, canvasSize, getClipBase]);

  // ---- Render ----
  return (
    <div className="preview-container">
      <div className="preview-toolbar">
        <select
          className="aspect-ratio-select"
          value={currentAspectIdx >= 0 ? currentAspectIdx : ''}
          onChange={handleAspectChange}
        >
          {currentAspectIdx < 0 && (
            <option value="" disabled>
              {exportSettings.width}×{exportSettings.height}
            </option>
          )}
          {ASPECT_RATIO_PRESETS.map((p, i) => (
            <option key={p.label} value={i}>
              {p.label}
            </option>
          ))}
        </select>
        <span className="aspect-ratio-dims">
          {exportSettings.width}×{exportSettings.height}
        </span>
      </div>
      <div
        className="preview-wrapper"
        ref={wrapperRef}
        onMouseDown={(e) => { handleCanvasPanDown(e); handleWrapperClick(e); }}
        onWheel={handleCanvasWheel}
      >
        <div
          className="canvas-zoom-layer"
          style={{ transform: `translate(${canvasPanX}px, ${canvasPanY}px) scale(${canvasZoom})` }}
        >
        <div className="canvas-rect" style={{ width: canvasSize.w, height: canvasSize.h }}>
        {/* Timeline composite: one ClipLayer per visible clip */}
        {hasTimelineClips && !showStandalone &&
          visibleClips.map((clip) => {
            const mediaFile = getMediaFile(clip.mediaPath);
            const mediaType = mediaFile?.type ?? 'video';
            const clipLocalTime = currentTime - clip.startTime;
            const { x, y, scale, scaleX, scaleY, rotation } = getAnimatedTransform(clip, clipLocalTime);
            const animMask = getAnimatedMask(clip, clipLocalTime);

            // For video/image clips, use natural size; for others, use canvas size
            const nat = naturalSizes[clip.id];
            const base = ((mediaType === 'video' || mediaType === 'image') && nat)
              ? fitSize(nat.w, nat.h, canvasSize.w, canvasSize.h)
              : { w: canvasSize.w, h: canvasSize.h };

            const elW = base.w * scale * scaleX;
            const elH = base.h * scale * scaleY;
            const style: React.CSSProperties =
              base.w > 0
                ? {
                    ...makeTransformStyle(x, y, scale, base.w, base.h, scaleX, scaleY, rotation, !!clip.flipX, !!clip.flipY),
                    ...(animMask ? { overflow: 'hidden' } : {}),
                    ...(animMask ? buildMaskStyle(animMask, elW, elH) : {}),
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

        {/* Standalone preview (media sidebar click) */}
        {showStandaloneVideo && (
          <video
            ref={standaloneRef}
            src={filePathToFileUrl(previewMediaPath!)}
            className="standalone-video"
            preload="auto"
            playsInline
          />
        )}
        {showStandaloneImage && (
          <img
            src={filePathToFileUrl(previewMediaPath!)}
            style={{ width: '100%', height: '100%', objectFit: 'contain' }}
            draggable={false}
          />
        )}

        {/* Single-clip transform handles */}
        {showSingleHandles && handleStyle && (
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
            <div className="canvas-rotation-stem" />
            <div
              className="canvas-rotation-handle"
              data-handle="1"
              onMouseDown={handleRotationDown}
            />
            {selectedMask && (
              <div
                className="mask-interact-box"
                style={{
                  left: `${(selectedMask.centerX - selectedMask.width / 2) * 100}%`,
                  top: `${(selectedMask.centerY - selectedMask.height / 2) * 100}%`,
                  width: `${selectedMask.width * 100}%`,
                  height: `${selectedMask.height * 100}%`,
                  borderRadius: selectedMask.shape === 'ellipse' ? '50%' : (() => {
                    const mwPx = selectedMask.width * handleBoxW;
                    const mhPx = selectedMask.height * handleBoxH;
                    const rPx = selectedMask.borderRadius * Math.min(mwPx, mhPx) * 2;
                    const rH = mwPx > 0 ? (rPx / mwPx) * 100 : 0;
                    const rV = mhPx > 0 ? (rPx / mhPx) * 100 : 0;
                    return `${rH}% / ${rV}%`;
                  })(),
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

        {/* Group bounding box for multi-select */}
        {showGroupBox && groupBoxStyle && (
          <>
            {/* Per-clip highlight outlines */}
            {selectedVisibleClips.map((vc) => {
              const base = getClipBase(vc);
              if (!base.w) return null;
              const clt = currentTime - vc.startTime;
              const anim = getAnimatedTransform(vc, clt);
              const style = makeTransformStyle(anim.x, anim.y, anim.scale, base.w, base.h, anim.scaleX, anim.scaleY, anim.rotation);
              return (
                <div key={vc.id} className="canvas-group-clip-outline" style={style} />
              );
            })}
            {/* Group box with handles */}
            <div
              className="canvas-group-box"
              style={groupBoxStyle}
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
              <div className="canvas-rotation-stem" />
              <div
                className="canvas-rotation-handle"
                data-handle="1"
                onMouseDown={handleRotationDown}
              />
            </div>
          </>
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
        </div>{/* end canvas-rect */}
        </div>{/* end canvas-zoom-layer */}

        {/* Canvas zoom indicator — click to reset */}
        <button
          className={`canvas-zoom-badge${canvasZoom !== 1 || canvasPanX !== 0 || canvasPanY !== 0 ? ' canvas-zoom-badge--active' : ''}`}
          onClick={resetCanvasView}
          title="Reset canvas view (fit)"
        >
          {Math.round(canvasZoom * 100)}%
        </button>
      </div>

      {/* Transport controls */}
      <div className="transport-controls">
        <div className="transport-left">
          <span className="timecode">{formatTime(currentTime)}</span>
        </div>
        <div className="transport-center">
          <Tooltip label="Skip back">
            <button className="btn-transport" onClick={skipBack}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M12 3L6 8l6 5V3z" fill="currentColor" />
                <rect x="3" y="3" width="2" height="10" rx="0.5" fill="currentColor" />
              </svg>
            </button>
          </Tooltip>
          <Tooltip label="Play/Pause" pos="bottom">
            <button className="btn-transport btn-play" onClick={togglePlay}>
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
          </Tooltip>
          <Tooltip label="Skip forward">
            <button className="btn-transport" onClick={skipForward}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M4 3l6 5-6 5V3z" fill="currentColor" />
                <rect x="11" y="3" width="2" height="10" rx="0.5" fill="currentColor" />
              </svg>
            </button>
          </Tooltip>
        </div>
        <div className="transport-right">
          <span className="timecode">{formatTime(duration)}</span>
        </div>
      </div>
    </div>
  );
}
