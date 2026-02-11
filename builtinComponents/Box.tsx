import React from 'react';
import type { ComponentClipProps } from '../src/types';

export const propDefinitions = {
  color: { type: 'color' as const, default: '#4a90d9', label: 'Color' },
  borderRadius: { type: 'number' as const, default: 0, label: 'Border Radius', min: 0, max: 500, step: 1 },
  padding: { type: 'number' as const, default: 0, label: 'Padding', min: 0, max: 500, step: 1 },
  shadow: { type: 'boolean' as const, default: false, label: 'Shadow' },
  child: { type: 'media' as const, default: '', label: 'Child' },
};

export default function Box({ width, height, color = '#4a90d9', borderRadius = 0, padding = 0, shadow = false, child }: ComponentClipProps) {
  return (
    <div style={{
      width,
      height,
      backgroundColor: color,
      borderRadius,
      padding,
      boxShadow: shadow ? '0 4px 16px rgba(0,0,0,0.3)' : 'none',
      boxSizing: 'border-box',
    }}>
      {child}
    </div>
  );
}
