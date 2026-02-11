import { useState, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';

interface TooltipProps {
  label: string;
  pos?: 'top' | 'bottom';
  children: React.ReactElement;
}

export default function Tooltip({ label, pos = 'top', children }: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const [coords, setCoords] = useState({ x: 0, y: 0 });
  const timerRef = useRef<ReturnType<typeof setTimeout>>();
  const wrapRef = useRef<HTMLSpanElement>(null);

  const show = useCallback(() => {
    timerRef.current = setTimeout(() => {
      const el = wrapRef.current?.firstElementChild as HTMLElement | null;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      setCoords({
        x: rect.left + rect.width / 2,
        y: pos === 'bottom' ? rect.bottom + 6 : rect.top - 6,
      });
      setVisible(true);
    }, 200);
  }, [pos]);

  const hide = useCallback(() => {
    clearTimeout(timerRef.current);
    setVisible(false);
  }, []);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  return (
    <>
      <span
        ref={wrapRef}
        onMouseEnter={show}
        onMouseLeave={hide}
        style={{ display: 'contents' }}
      >
        {children}
      </span>
      {visible &&
        createPortal(
          <div
            className="tooltip"
            style={{
              left: coords.x,
              top: coords.y,
              transform: pos === 'bottom' ? 'translateX(-50%)' : 'translateX(-50%) translateY(-100%)',
            }}
          >
            {label}
          </div>,
          document.body,
        )}
    </>
  );
}
