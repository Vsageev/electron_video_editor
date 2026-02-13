import React, { useRef, useState, useEffect, useCallback } from 'react';
import type { ComponentClipProps } from '../src/types';

export const propDefinitions = {
  main: { type: 'media' as const, default: '', label: 'Main Window' },
  window1: { type: 'media' as const, default: '', label: 'Window 1' },
  window2: { type: 'media' as const, default: '', label: 'Window 2' },
  window3: { type: 'media' as const, default: '', label: 'Window 3' },
  window4: { type: 'media' as const, default: '', label: 'Window 4' },
  window5: { type: 'media' as const, default: '', label: 'Window 5' },
  window6: { type: 'media' as const, default: '', label: 'Window 6' },
  window7: { type: 'media' as const, default: '', label: 'Window 7' },
  window8: { type: 'media' as const, default: '', label: 'Window 8' },
  gridStart: { type: 'number' as const, default: 1.0, label: 'Grid Start (s)', min: 0, max: 30, step: 0.1 },
  gridDuration: { type: 'number' as const, default: 3.0, label: 'Grid Duration (s)', min: 0.5, max: 30, step: 0.1 },
  transitionSpeed: { type: 'number' as const, default: 0.6, label: 'Transition Speed (s)', min: 0.1, max: 3, step: 0.05 },
  gap: { type: 'number' as const, default: 20, label: 'Grid Gap', min: 0, max: 100, step: 1 },
};

export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export interface WindowSlot {
  key: string;
  node: React.ReactNode;
  isMain: boolean;
}

export function computeAnimT(
  currentTime: number,
  gridStart: number,
  transitionSpeed: number,
  gridDuration: number,
): number {
  const zoomOutEnd = gridStart + transitionSpeed;
  const gridEnd = zoomOutEnd + gridDuration;
  const zoomInEnd = gridEnd + transitionSpeed;

  if (currentTime >= gridStart && currentTime < zoomOutEnd) {
    return easeInOutCubic(clamp((currentTime - gridStart) / transitionSpeed, 0, 1));
  } else if (currentTime >= zoomOutEnd && currentTime < gridEnd) {
    return 1;
  } else if (currentTime >= gridEnd && currentTime < zoomInEnd) {
    return 1 - easeInOutCubic(clamp((currentTime - gridEnd) / transitionSpeed, 0, 1));
  }
  return 0;
}

/**
 * macOS Mission Control–style layout.
 *
 * Each window's cell matches its CONTENT aspect ratio (measured from the
 * visible DOM). Falls back to canvas AR until measurement completes.
 */
export function computeGridPositions(
  slots: WindowSlot[],
  canvasW: number,
  canvasH: number,
  gap: number,
  aspectRatios: number[], // per-slot measured AR (w/h), 0 = unknown
): { x: number; y: number; w: number; h: number }[] {
  const count = slots.length;
  if (count === 0) return [];

  const canvasAR = canvasW / canvasH;
  const ars = slots.map((_, i) => (aspectRatios[i] && aspectRatios[i] > 0) ? aspectRatios[i] : canvasAR);

  if (count === 1) {
    const ar = ars[0];
    let w: number, h: number;
    if (ar > canvasAR) {
      w = canvasW * 0.8;
      h = w / ar;
    } else {
      h = canvasH * 0.8;
      w = h * ar;
    }
    return [{ x: (canvasW - w) / 2, y: (canvasH - h) / 2, w, h }];
  }

  // Deterministic pseudo-random
  function seededRandom(seed: number) {
    let s = seed;
    return () => {
      s = (s * 1664525 + 1013904223) & 0x7fffffff;
      return s / 0x7fffffff;
    };
  }
  const rand = seededRandom(count * 7919 + 31);

  // --- Grid estimation ---
  const cols = Math.max(1, Math.round(Math.sqrt(count * canvasAR)));
  const rows = Math.max(1, Math.ceil(count / cols));
  const cellW = canvasW / cols;
  const cellH = canvasH / rows;

  // --- Cell assignment: main gets center cell ---
  const mainIdx = slots.findIndex(s => s.isMain);
  const centerCell = Math.floor(rows / 2) * cols + Math.floor(cols / 2);
  const cellAssignment: number[] = new Array(count);
  const usedCells = new Set<number>();

  if (mainIdx >= 0 && centerCell < rows * cols) {
    cellAssignment[mainIdx] = centerCell;
    usedCells.add(centerCell);
  }
  let nextCell = 0;
  for (let i = 0; i < count; i++) {
    if (i === mainIdx) continue;
    while (usedCells.has(nextCell)) nextCell++;
    cellAssignment[i] = nextCell;
    usedCells.add(nextCell);
    nextCell++;
  }

  // --- Size each window using its own AR ---
  type R = { x: number; y: number; w: number; h: number };
  const rects: R[] = [];
  const mainCellScale = 0.92;
  const secCellScale = 0.85;

  for (let i = 0; i < count; i++) {
    const cell = cellAssignment[i];
    const col = cell % cols;
    const row = Math.floor(cell / cols);
    const isMain = slots[i].isMain;
    const fillScale = isMain ? mainCellScale : secCellScale;
    const ar = ars[i];

    const availW = cellW - gap;
    const availH = cellH - gap;
    const s = Math.min(availW / ar, availH) * fillScale;
    const w = s * ar;
    const h = s;

    const cx = col * cellW + (cellW - w) / 2 + (rand() - 0.5) * cellW * 0.06;
    const cy = row * cellH + (cellH - h) / 2 + (rand() - 0.5) * cellH * 0.06;
    rects.push({ x: cx, y: cy, w, h });
  }

  for (const r of rects) {
    r.x = clamp(r.x, 0, canvasW - r.w);
    r.y = clamp(r.y, 0, canvasH - r.h);
  }

  // --- AABB overlap repulsion ---
  for (let iter = 0; iter < 20; iter++) {
    let anyOverlap = false;
    for (let i = 0; i < count; i++) {
      for (let j = i + 1; j < count; j++) {
        const a = rects[i];
        const b = rects[j];
        const overlapX = (a.w / 2 + b.w / 2 + gap) - Math.abs((a.x + a.w / 2) - (b.x + b.w / 2));
        const overlapY = (a.h / 2 + b.h / 2 + gap) - Math.abs((a.y + a.h / 2) - (b.y + b.h / 2));
        if (overlapX > 0 && overlapY > 0) {
          anyOverlap = true;
          if (overlapX < overlapY) {
            const sign = (a.x + a.w / 2) < (b.x + b.w / 2) ? 1 : -1;
            a.x -= sign * overlapX * 0.26;
            b.x += sign * overlapX * 0.26;
          } else {
            const sign = (a.y + a.h / 2) < (b.y + b.h / 2) ? 1 : -1;
            a.y -= sign * overlapY * 0.26;
            b.y += sign * overlapY * 0.26;
          }
        }
      }
    }
    for (const r of rects) {
      r.x = clamp(r.x, 0, canvasW - r.w);
      r.y = clamp(r.y, 0, canvasH - r.h);
    }
    if (!anyOverlap) break;
  }

  return rects;
}

/** Try to extract natural w/h from a DOM container's media children. */
function measureNaturalSize(el: HTMLElement): { w: number; h: number } | null {
  const video = el.querySelector('video');
  if (video && video.videoWidth > 0 && video.videoHeight > 0) {
    return { w: video.videoWidth, h: video.videoHeight };
  }
  const img = el.querySelector('img');
  if (img && img.naturalWidth > 0 && img.naturalHeight > 0) {
    return { w: img.naturalWidth, h: img.naturalHeight };
  }
  return null;
}

export default function MissionControl({
  width,
  height,
  currentTime,
  main,
  window1,
  window2,
  window3,
  window4,
  window5,
  window6,
  window7,
  window8,
  gridStart = 1.0,
  gridDuration = 3.0,
  transitionSpeed = 0.6,
  gap = 20,
}: ComponentClipProps) {
  const allSlots: WindowSlot[] = [];
  if (main) allSlots.push({ key: 'main', node: main, isMain: true });
  const extras: { key: string; node: React.ReactNode }[] = [
    { key: 'w1', node: window1 },
    { key: 'w2', node: window2 },
    { key: 'w3', node: window3 },
    { key: 'w4', node: window4 },
    { key: 'w5', node: window5 },
    { key: 'w6', node: window6 },
    { key: 'w7', node: window7 },
    { key: 'w8', node: window8 },
  ];
  for (const e of extras) {
    if (e.node) allSlots.push({ key: e.key, node: e.node, isMain: false });
  }

  // Refs for each visible window cell — used to measure content AR
  const cellRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [measuredSizes, setMeasuredSizes] = useState<Record<string, { w: number; h: number }>>({});

  // On every render, try to measure any slots that haven't been measured yet.
  // This runs as a layout effect so it catches video/img metadata as soon
  // as they become available (after loadedmetadata / load events fire).
  useEffect(() => {
    let needsUpdate = false;
    const next = { ...measuredSizes };

    for (const slot of allSlots) {
      if (next[slot.key]) continue; // already measured
      const el = cellRefs.current[slot.key];
      if (!el) continue;
      const size = measureNaturalSize(el);
      if (size) {
        next[slot.key] = size;
        needsUpdate = true;
      }
    }

    if (needsUpdate) {
      setMeasuredSizes(next);
    }
  });

  // Also listen for loadedmetadata / load on any unmeasured video/img elements
  // so we pick up dimensions as soon as they arrive
  useEffect(() => {
    const unmeasuredKeys = allSlots
      .filter(s => !measuredSizes[s.key])
      .map(s => s.key);
    if (unmeasuredKeys.length === 0) return;

    const handlers: Array<{ el: HTMLElement; event: string; fn: () => void }> = [];

    for (const key of unmeasuredKeys) {
      const container = cellRefs.current[key];
      if (!container) continue;

      const video = container.querySelector('video');
      if (video && !(video.videoWidth > 0)) {
        const fn = () => {
          if (video.videoWidth > 0 && video.videoHeight > 0) {
            setMeasuredSizes(prev => {
              if (prev[key]) return prev;
              return { ...prev, [key]: { w: video.videoWidth, h: video.videoHeight } };
            });
          }
        };
        video.addEventListener('loadedmetadata', fn);
        handlers.push({ el: video, event: 'loadedmetadata', fn });
        continue;
      }

      const img = container.querySelector('img');
      if (img && !(img.naturalWidth > 0)) {
        const fn = () => {
          if (img.naturalWidth > 0 && img.naturalHeight > 0) {
            setMeasuredSizes(prev => {
              if (prev[key]) return prev;
              return { ...prev, [key]: { w: img.naturalWidth, h: img.naturalHeight } };
            });
          }
        };
        img.addEventListener('load', fn);
        handlers.push({ el: img, event: 'load', fn });
      }
    }

    return () => {
      for (const { el, event, fn } of handlers) {
        el.removeEventListener(event, fn);
      }
    };
  }, [allSlots.map(s => s.key).join(','), Object.keys(measuredSizes).join(',')]);

  const aspectRatios = allSlots.map(slot => {
    const m = measuredSizes[slot.key];
    return m ? m.w / m.h : 0;
  });

  const animT = computeAnimT(currentTime, gridStart, transitionSpeed, gridDuration);
  const gridPositions = computeGridPositions(allSlots, width, height, gap, aspectRatios);

  const setRef = useCallback((key: string, el: HTMLDivElement | null) => {
    cellRefs.current[key] = el;
  }, []);

  return (
    <div style={{ width, height, position: 'relative', overflow: 'hidden' }}>
      {allSlots.map((slot, i) => {
        const grid = gridPositions[i];
        if (!grid) return null;

        const m = measuredSizes[slot.key];
        const naturalW = m ? m.w : width;
        const naturalH = m ? m.h : height;

        // Fullscreen state: main fills screen, others emerge from their grid center
        let fullX: number, fullY: number, fullW: number, fullH: number;
        if (slot.isMain) {
          fullX = 0; fullY = 0;
          fullW = width; fullH = height;
        } else {
          fullX = grid.x + grid.w / 2;
          fullY = grid.y + grid.h / 2;
          fullW = 0; fullH = 0;
        }

        const x = fullX + (grid.x - fullX) * animT;
        const y = fullY + (grid.y - fullY) * animT;
        const w = fullW + (grid.w - fullW) * animT;
        const h = fullH + (grid.h - fullH) * animT;

        const opacity = slot.isMain ? 1 : animT;
        if (!slot.isMain && animT === 0) return null;

        const borderRadius = 10 * animT;
        const isHighlighted = slot.isMain && animT > 0;

        // Scale content to fill cell — cell AR matches content AR so
        // sx ≈ sy; use min to guard against float drift
        const sx = w / naturalW;
        const sy = h / naturalH;
        const s = Math.min(sx, sy);
        const offsetX = (w - naturalW * s) / 2;
        const offsetY = (h - naturalH * s) / 2;

        return (
          <div
            key={slot.key}
            style={{
              position: 'absolute',
              left: x,
              top: y,
              width: w,
              height: h,
              opacity,
              overflow: 'hidden',
              borderRadius,
              boxShadow: isHighlighted
                ? `0 0 0 2.5px rgba(59,130,246,${animT * 0.7}), 0 12px 40px rgba(0,0,0,${animT * 0.6})`
                : animT > 0 ? `0 8px 30px rgba(0,0,0,${animT * 0.5})` : 'none',
              zIndex: slot.isMain ? 10 : 1,
            }}
          >
            <div
              ref={(el) => setRef(slot.key, el)}
              style={{
                position: 'absolute',
                left: offsetX,
                top: offsetY,
                width: naturalW,
                height: naturalH,
                transform: `scale(${s})`,
                transformOrigin: '0 0',
              }}
            >
              {slot.node}
            </div>
          </div>
        );
      })}
    </div>
  );
}
