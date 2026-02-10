import React from 'react';
import type { ComponentClipProps } from '../src/types';

export const propDefinitions = {
  label: { type: 'string' as const, default: '', label: 'Label' },
  color: { type: 'color' as const, default: '#ffffff', label: 'Color' },
};

export default function CountdownTimer({ currentTime, duration, width, height, progress, label = '', color = '#ffffff' }: ComponentClipProps) {
  const remaining = Math.max(0, Math.ceil(duration - currentTime));
  const fontSize = Math.min(width, height) * 0.3;

  return (
    <div style={{
      width, height,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'radial-gradient(circle, #1a1a2e 0%, #0a0a15 100%)',
      fontFamily: 'monospace',
      color,
    }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{
          fontSize,
          fontWeight: 700,
          letterSpacing: '0.05em',
          textShadow: '0 0 20px rgba(100, 180, 255, 0.5)',
        }}>
          {remaining}
        </div>
        {label && (
          <div style={{
            marginTop: fontSize * 0.1,
            fontSize: fontSize * 0.15,
            opacity: 0.7,
            letterSpacing: '0.1em',
          }}>
            {label}
          </div>
        )}
        <div style={{
          marginTop: fontSize * 0.15,
          height: 4,
          width: fontSize * 2,
          background: 'rgba(255,255,255,0.15)',
          borderRadius: 2,
          overflow: 'hidden',
        }}>
          <div style={{
            width: `${(1 - progress) * 100}%`,
            height: '100%',
            background: 'linear-gradient(90deg, #64b4ff, #a78bfa)',
            borderRadius: 2,
            transition: 'width 0.1s linear',
          }} />
        </div>
      </div>
    </div>
  );
}
