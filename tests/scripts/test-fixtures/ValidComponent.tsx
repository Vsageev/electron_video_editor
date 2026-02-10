import React from 'react';

export default function ValidComponent({ width, height, progress }: {
  width: number; height: number; progress: number;
  currentTime: number; duration: number;
}) {
  return (
    <div style={{ width, height, background: `hsl(${progress * 360}, 70%, 50%)` }}>
      Hello
    </div>
  );
}
