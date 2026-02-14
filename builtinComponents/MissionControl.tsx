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
 * macOS Mission Control–style layout via AR-aware binary space partition.
 *
 * Recursively bisects the canvas into regions proportional to each window's
 * weight, then at each leaf fits the window into its region preserving its
 * content AR. This produces tight, space-efficient packing with varied
 * window sizes — not a uniform grid.
 *
 * Main window gets a larger weight so it occupies more area.
 * `gap` controls spacing between windows.
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
      w = canvasW * 0.92;
      h = w / ar;
    } else {
      h = canvasH * 0.92;
      w = h * ar;
    }
    return [{ x: (canvasW - w) / 2, y: (canvasH - h) / 2, w, h }];
  }

  type R = { x: number; y: number; w: number; h: number };

  // Main gets 2× weight so it's noticeably larger
  const mainIdx = slots.findIndex(s => s.isMain);
  const secondaryCount = mainIdx >= 0 ? count - 1 : count;
  const mainWeight = 1.8 + secondaryCount * 0.15; // grows slightly with more windows

  // Build weighted items sorted heaviest-first (main wins first split)
  const items: { weight: number; slotIndex: number; ar: number }[] = [];
  for (let i = 0; i < count; i++) {
    items.push({
      weight: i === mainIdx ? mainWeight : 1,
      slotIndex: i,
      ar: ars[i],
    });
  }
  items.sort((a, b) => b.weight - a.weight);

  const results: R[] = new Array(count);
  const halfGap = gap / 2;

  /**
   * Recursive BSP: split the rectangle into two halves weighted by total
   * item weight, choosing the split axis that minimises AR mismatch.
   */
  function partition(
    items: { weight: number; slotIndex: number; ar: number }[],
    x: number, y: number, w: number, h: number,
  ) {
    if (items.length === 0) return;

    if (items.length === 1) {
      // Leaf: fit window AR inside region, centered
      const item = items[0];
      const regionW = Math.max(0, w - gap);
      const regionH = Math.max(0, h - gap);
      const ar = item.ar;

      let fitW: number, fitH: number;
      if (ar > regionW / regionH) {
        fitW = regionW;
        fitH = regionW / ar;
      } else {
        fitH = regionH;
        fitW = regionH * ar;
      }

      results[item.slotIndex] = {
        x: x + halfGap + (regionW - fitW) / 2,
        y: y + halfGap + (regionH - fitH) / 2,
        w: fitW,
        h: fitH,
      };
      return;
    }

    // Find best split point (closest to 50% of total weight)
    const totalWeight = items.reduce((s, it) => s + it.weight, 0);
    let bestSplit = 1;
    let bestDiff = Infinity;
    let running = 0;
    for (let i = 0; i < items.length - 1; i++) {
      running += items[i].weight;
      const diff = Math.abs(running / totalWeight - 0.5);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestSplit = i + 1;
      }
    }

    const left = items.slice(0, bestSplit);
    const right = items.slice(bestSplit);
    const leftWeight = left.reduce((s, it) => s + it.weight, 0);
    const ratio = leftWeight / totalWeight;

    // Choose split axis: try both, pick the one that yields better
    // aspect-ratio fit for the dominant item on each side
    const leftAR = left[0].ar;
    const rightAR = right[0].ar;

    // Score a split: how well does each side's dominant AR fit its region?
    function fitScore(
      lw: number, lh: number, rw: number, rh: number,
    ): number {
      // Ratio of used area to region area (1.0 = perfect)
      const lRegionAR = lw / lh;
      const lFill = leftAR > lRegionAR
        ? (lw * (lw / leftAR)) / (lw * lh)
        : ((lh * leftAR) * lh) / (lw * lh);
      const rRegionAR = rw / rh;
      const rFill = rightAR > rRegionAR
        ? (rw * (rw / rightAR)) / (rw * rh)
        : ((rh * rightAR) * rh) / (rw * rh);
      return lFill * leftWeight + rFill * (totalWeight - leftWeight);
    }

    const hScore = fitScore(w * ratio, h, w * (1 - ratio), h);
    const vScore = fitScore(w, h * ratio, w, h * (1 - ratio));

    if (hScore >= vScore) {
      // Split horizontally (side by side)
      const splitW = w * ratio;
      partition(left, x, y, splitW, h);
      partition(right, x + splitW, y, w - splitW, h);
    } else {
      // Split vertically (stacked)
      const splitH = h * ratio;
      partition(left, x, y, w, splitH);
      partition(right, x, y + splitH, w, h - splitH);
    }
  }

  partition(items, 0, 0, canvasW, canvasH);
  return results;
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
