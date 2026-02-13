import React from 'react';
import type { ComponentClipProps } from '../src/types';

export const propDefinitions = {
  text: { type: 'string' as const, default: 'Sample Text', label: 'Text' },
  color: { type: 'color' as const, default: '#ffffff', label: 'Text Color' },
  backgroundColor: { type: 'color' as const, default: 'rgba(0,0,0,0.4)', label: 'Background' },
  verticalAlign: { type: 'enum' as const, options: ['center', 'top', 'bottom'], default: 'center', label: 'Vertical Align' },
};

const ALIGN_MAP: Record<string, string> = { top: 'flex-start', center: 'center', bottom: 'flex-end' };

export default function TextOverlay({ width, height, progress, text = 'Sample Text', color = '#ffffff', backgroundColor = 'rgba(0,0,0,0.4)', verticalAlign = 'center' }: ComponentClipProps) {
  const opacity = progress < 0.1 ? progress / 0.1
    : progress > 0.9 ? (1 - progress) / 0.1
    : 1;
  const fontSize = Math.min(width, height) * 0.08;

  return (
    <div style={{
      width,
      height,
      display: 'flex',
      alignItems: ALIGN_MAP[verticalAlign as string] || 'center',
      justifyContent: 'center',
      opacity,
      padding: verticalAlign === 'bottom' ? '0 0 5% 0' : verticalAlign === 'top' ? '5% 0 0 0' : undefined,
    }}>
      <div style={{
        fontSize,
        fontFamily: 'sans-serif',
        fontWeight: 600,
        color,
        textShadow: '0 2px 8px rgba(0,0,0,0.7)',
        padding: '0.3em 0.6em',
        background: backgroundColor,
        borderRadius: 8,
      }}>
        {text}
      </div>
    </div>
  );
}
