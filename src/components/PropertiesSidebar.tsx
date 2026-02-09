import { useCallback } from 'react';
import { useEditorStore } from '../store/editorStore';
import { formatTime } from '../utils/formatTime';

export default function PropertiesSidebar() {
  const { timelineClips, selectedClipId, updateClip } = useEditorStore();
  const clip = timelineClips.find((c) => c.id === selectedClipId);

  const handleChange = useCallback(
    (prop: string, value: string) => {
      if (!clip) return;
      const val = parseFloat(value) || 0;

      if (prop === 'startTime') {
        updateClip(clip.id, { startTime: Math.max(0, val) });
      } else if (prop === 'trimStart') {
        const trimStart = Math.max(0, Math.min(val, clip.originalDuration - clip.trimEnd - 0.1));
        const duration = clip.originalDuration - trimStart - clip.trimEnd;
        updateClip(clip.id, { trimStart, duration });
      } else if (prop === 'trimEnd') {
        const trimEnd = Math.max(0, Math.min(val, clip.originalDuration - clip.trimStart - 0.1));
        const duration = clip.originalDuration - clip.trimStart - trimEnd;
        updateClip(clip.id, { trimEnd, duration });
      } else if (prop === 'x') {
        updateClip(clip.id, { x: val });
      } else if (prop === 'y') {
        updateClip(clip.id, { y: val });
      } else if (prop === 'scale') {
        updateClip(clip.id, { scale: Math.max(0.1, val) });
      }
    },
    [clip, updateClip]
  );

  const handleResetTransform = useCallback(() => {
    if (!clip) return;
    updateClip(clip.id, { x: 0, y: 0, scale: 1 });
  }, [clip, updateClip]);

  return (
    <aside className="sidebar sidebar-right">
      <div className="sidebar-header">
        <span className="sidebar-label">PROPERTIES</span>
      </div>
      <div className="properties-content">
        {!clip ? (
          <div className="properties-empty">
            <p>Select a clip to view properties</p>
          </div>
        ) : (
          <>
            <div className="property-group">
              <div className="property-group-title">Clip Info</div>
              <div className="property-row">
                <span className="property-label">Name</span>
                <span className="property-value">{clip.mediaName}</span>
              </div>
              <div className="property-row">
                <span className="property-label">Type</span>
                <span className="property-value" style={{ textTransform: 'capitalize' }}>
                  {clip.type}
                </span>
              </div>
            </div>

            <div className="property-group">
              <div className="property-group-title">Timing</div>
              <div className="property-row">
                <span className="property-label">Start</span>
                <input
                  className="property-input"
                  type="number"
                  step="0.1"
                  min="0"
                  value={clip.startTime.toFixed(2)}
                  onChange={(e) => handleChange('startTime', e.target.value)}
                />
              </div>
              <div className="property-row">
                <span className="property-label">Duration</span>
                <span className="property-value">{formatTime(clip.duration)}</span>
              </div>
              <div className="property-row">
                <span className="property-label">Original</span>
                <span className="property-value">{formatTime(clip.originalDuration)}</span>
              </div>
            </div>

            {clip.type === 'video' && (
              <div className="property-group">
                <div className="property-group-title">
                  Transform
                  <button className="property-reset-btn" onClick={handleResetTransform} title="Reset transform">
                    Reset
                  </button>
                </div>
                <div className="property-row">
                  <span className="property-label">X</span>
                  <input
                    className="property-input"
                    type="number"
                    step="0.01"
                    value={clip.x.toFixed(2)}
                    onChange={(e) => handleChange('x', e.target.value)}
                  />
                </div>
                <div className="property-row">
                  <span className="property-label">Y</span>
                  <input
                    className="property-input"
                    type="number"
                    step="0.01"
                    value={clip.y.toFixed(2)}
                    onChange={(e) => handleChange('y', e.target.value)}
                  />
                </div>
                <div className="property-row">
                  <span className="property-label">Scale</span>
                  <input
                    className="property-input"
                    type="number"
                    step="0.05"
                    min="0.1"
                    value={clip.scale.toFixed(2)}
                    onChange={(e) => handleChange('scale', e.target.value)}
                  />
                </div>
              </div>
            )}

            <div className="property-group">
              <div className="property-group-title">Trim</div>
              <div className="property-row">
                <span className="property-label">Trim Start</span>
                <input
                  className="property-input"
                  type="number"
                  step="0.1"
                  min="0"
                  value={clip.trimStart.toFixed(2)}
                  onChange={(e) => handleChange('trimStart', e.target.value)}
                />
              </div>
              <div className="property-row">
                <span className="property-label">Trim End</span>
                <input
                  className="property-input"
                  type="number"
                  step="0.1"
                  min="0"
                  value={clip.trimEnd.toFixed(2)}
                  onChange={(e) => handleChange('trimEnd', e.target.value)}
                />
              </div>
            </div>
          </>
        )}
      </div>
    </aside>
  );
}
