import React from 'react';
import type { ComponentClipProps } from '../src/types';

export const propDefinitions = {
  startHue: { type: 'number' as const, default: 0, label: 'Start Hue', min: 0, max: 360, step: 1 },
  endHueOffset: { type: 'number' as const, default: 60, label: 'Hue Offset', min: 0, max: 360, step: 1 },
};

export default function ColorBackground({ width, height, progress, startHue = 0, endHueOffset = 60 }: ComponentClipProps) {
  const hue = Math.round(startHue + progress * 360) % 360;

  return (
    <div style={{
      width,
      height,
      background: `linear-gradient(135deg, hsl(${hue}, 70%, 50%), hsl(${(hue + endHueOffset) % 360}, 80%, 40%))`,
    }} />
  );
}
