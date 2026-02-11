import React from 'react';
import type { ComponentClipProps } from '../src/types';

export const propDefinitions = {
  mode: { type: 'enum' as const, default: 'shake', label: 'Mode', options: ['shake', 'shakeX', 'shakeY', 'shakeRotate', 'spin'] },
  intensity: { type: 'number' as const, default: 5, label: 'Intensity', min: 0, max: 100, step: 1 },
  child: { type: 'component' as const, default: '', label: 'Child' },
};

export default function Animation({
  width,
  height,
  currentTime,
  mode = 'shake',
  intensity = 5,
  child,
}: ComponentClipProps) {
  const hasChild = !!child;

  let transform = '';
  if (mode === 'shake') {
    const offsetX = Math.sin(currentTime * 20) * intensity;
    const offsetY = Math.cos(currentTime * 23) * intensity * 0.7;
    transform = `translate(${offsetX}px, ${offsetY}px)`;
  } else if (mode === 'shakeX') {
    const offset = Math.sin(currentTime * 20) * intensity;
    transform = `translateX(${offset}px)`;
  } else if (mode === 'shakeY') {
    const offset = Math.sin(currentTime * 20) * intensity;
    transform = `translateY(${offset}px)`;
  } else if (mode === 'shakeRotate') {
    const angle = Math.sin(currentTime * 20) * intensity;
    transform = `rotate(${angle}deg)`;
  } else if (mode === 'spin') {
    const deg = currentTime * intensity * 36;
    transform = `rotate(${deg}deg)`;
  }

  return (
    <div
      style={{
        width,
        height,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        border: hasChild ? 'none' : '2px solid red',
      }}
    >
      <div style={{ transform, width: '100%', height: '100%' }}>
        {hasChild ? child : (
          <div style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#ff6b6b',
            fontSize: 14,
          }}>
            No child component
          </div>
        )}
      </div>
    </div>
  );
}
