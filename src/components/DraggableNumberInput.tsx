import { useCallback, useRef, useState } from 'react';

interface DraggableNumberInputProps {
  className?: string;
  value: string | number;
  step?: number;
  min?: number;
  max?: number;
  title?: string;
  onChange: (value: number) => void;
}

const DRAG_THRESHOLD = 2;

export default function DraggableNumberInput({
  className = 'property-input',
  value,
  step = 1,
  min,
  max,
  title,
  onChange,
}: DraggableNumberInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const clamp = useCallback(
    (v: number) => {
      let r = v;
      if (min !== undefined) r = Math.max(min, r);
      if (max !== undefined) r = Math.min(max, r);
      return r;
    },
    [min, max],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      // Only left button; skip if input is already focused (user is typing)
      if (e.button !== 0 || document.activeElement === inputRef.current) return;

      e.preventDefault();
      const startX = e.clientX;
      const startVal = parseFloat(String(value)) || 0;
      let dragged = false;

      const onMove = (ev: MouseEvent) => {
        const dx = ev.clientX - startX;
        if (!dragged && Math.abs(dx) < DRAG_THRESHOLD) return;
        if (!dragged) {
          dragged = true;
          setIsDragging(true);
          document.body.style.cursor = 'ew-resize';
        }
        // Shift = fine (0.1x), no modifier = normal
        const multiplier = ev.shiftKey ? 0.1 : 1;
        const newVal = clamp(startVal + dx * step * multiplier);
        // Round to avoid floating point noise
        const decimals = Math.max(0, -Math.floor(Math.log10(step * multiplier)) + 1);
        onChange(parseFloat(newVal.toFixed(decimals)));
      };

      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.body.style.cursor = '';
        if (!dragged) {
          // Click without drag — focus the input for typing
          inputRef.current?.focus();
          inputRef.current?.select();
        }
        setIsDragging(false);
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [value, step, clamp, onChange],
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = parseFloat(e.target.value);
      if (!isNaN(val)) onChange(clamp(val));
    },
    [onChange, clamp],
  );

  return (
    <input
      ref={inputRef}
      className={className}
      type="number"
      step={step}
      min={min}
      max={max}
      title={title}
      value={value}
      style={{ cursor: isDragging ? 'ew-resize' : undefined }}
      onChange={handleInputChange}
      onMouseDown={handleMouseDown}
    />
  );
}
