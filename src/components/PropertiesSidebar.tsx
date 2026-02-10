import { useCallback, useMemo, useState } from 'react';
import { useEditorStore } from '../store/editorStore';
import { formatTime } from '../utils/formatTime';
import { evaluateKeyframes } from '../utils/keyframeEngine';
import type { AnimatableProp, EasingType, Keyframe, MaskShape, ClipMask, PropDefinition } from '../types';

const MASK_SHAPES: MaskShape[] = ['none', 'rectangle', 'ellipse'];
const MASK_ANIMATABLE_PROPS: AnimatableProp[] = ['maskCenterX', 'maskCenterY', 'maskWidth', 'maskHeight', 'maskFeather'];

function defaultMask(shape: MaskShape): ClipMask {
  return { shape, centerX: 0.5, centerY: 0.5, width: 0.8, height: 0.8, rotation: 0, feather: 0, borderRadius: 0, invert: false };
}

const EASING_OPTIONS: EasingType[] = ['linear', 'ease-in', 'ease-out', 'ease-in-out'];
const EASING_LABELS: Record<EasingType, string> = {
  'linear': 'Linear',
  'ease-in': 'Ease In',
  'ease-out': 'Ease Out',
  'ease-in-out': 'Ease In-Out',
};

function KeyframeButton({
  clipId,
  prop,
  keyframes,
  currentValue,
  clipLocalTime,
}: {
  clipId: number;
  prop: AnimatableProp;
  keyframes: Keyframe[] | undefined;
  currentValue: number;
  clipLocalTime: number;
}) {
  const addKeyframe = useEditorStore((s) => s.addKeyframe);
  const removeKeyframe = useEditorStore((s) => s.removeKeyframe);

  const existingAtTime = keyframes?.find((k) => Math.abs(k.time - clipLocalTime) < 0.02);
  const hasAny = keyframes && keyframes.length > 0;

  const state: 'active' | 'has-others' | 'none' = existingAtTime
    ? 'active'
    : hasAny
      ? 'has-others'
      : 'none';

  const handleClick = useCallback(() => {
    if (existingAtTime) {
      removeKeyframe(clipId, prop, existingAtTime.id);
    } else {
      addKeyframe(clipId, prop, clipLocalTime, currentValue, 'linear');
    }
  }, [clipId, prop, clipLocalTime, currentValue, existingAtTime, addKeyframe, removeKeyframe]);

  return (
    <button
      className={`keyframe-btn keyframe-btn-${state}`}
      onClick={handleClick}
      title={
        existingAtTime
          ? 'Remove keyframe'
          : 'Add keyframe at current time'
      }
    >
      <span className="keyframe-diamond" />
    </button>
  );
}

export default function PropertiesSidebar() {
  const { timelineClips, selectedClipId, updateClip, mediaFiles } = useEditorStore();
  const currentTime = useEditorStore((s) => s.currentTime);
  const addKeyframe = useEditorStore((s) => s.addKeyframe);
  const updateKeyframe = useEditorStore((s) => s.updateKeyframe);
  const removeKeyframe = useEditorStore((s) => s.removeKeyframe);
  const clip = timelineClips.find((c) => c.id === selectedClipId);
  const clipMedia = clip ? mediaFiles.find((m) => m.path === clip.mediaPath) : undefined;

  const clipLocalTime = clip ? currentTime - clip.startTime : 0;

  const animatedValues = useMemo(() => {
    if (!clip) return { x: 0, y: 0, scale: 1, scaleX: 1, scaleY: 1, maskCenterX: 0.5, maskCenterY: 0.5, maskWidth: 0.8, maskHeight: 0.8, maskFeather: 0 };
    const m = clip.mask;
    return {
      x: evaluateKeyframes(clip.keyframes?.x, clipLocalTime, clip.x),
      y: evaluateKeyframes(clip.keyframes?.y, clipLocalTime, clip.y),
      scale: evaluateKeyframes(clip.keyframes?.scale, clipLocalTime, clip.scale),
      scaleX: evaluateKeyframes(clip.keyframes?.scaleX, clipLocalTime, clip.scaleX),
      scaleY: evaluateKeyframes(clip.keyframes?.scaleY, clipLocalTime, clip.scaleY),
      maskCenterX: evaluateKeyframes(clip.keyframes?.maskCenterX, clipLocalTime, m?.centerX ?? 0.5),
      maskCenterY: evaluateKeyframes(clip.keyframes?.maskCenterY, clipLocalTime, m?.centerY ?? 0.5),
      maskWidth: evaluateKeyframes(clip.keyframes?.maskWidth, clipLocalTime, m?.width ?? 0.8),
      maskHeight: evaluateKeyframes(clip.keyframes?.maskHeight, clipLocalTime, m?.height ?? 0.8),
      maskFeather: evaluateKeyframes(clip.keyframes?.maskFeather, clipLocalTime, m?.feather ?? 0),
    };
  }, [clip, clipLocalTime]);

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
      } else if (prop === 'x' || prop === 'y' || prop === 'scale' || prop === 'scaleX' || prop === 'scaleY') {
        const finalVal = (prop === 'scale' || prop === 'scaleX' || prop === 'scaleY') ? Math.max(0.1, val) : val;
        const kfs = clip.keyframes?.[prop as AnimatableProp];
        if (kfs && kfs.length > 0) {
          const existing = kfs.find((k) => Math.abs(k.time - clipLocalTime) < 0.02);
          if (existing) {
            updateKeyframe(clip.id, prop as AnimatableProp, existing.id, { value: finalVal });
          } else {
            addKeyframe(clip.id, prop as AnimatableProp, clipLocalTime, finalVal, 'linear');
          }
        } else {
          updateClip(clip.id, { [prop]: finalVal });
        }
      } else if (prop.startsWith('mask')) {
        // Mask animatable properties
        const maskPropMap: Record<string, keyof ClipMask> = {
          maskCenterX: 'centerX', maskCenterY: 'centerY',
          maskWidth: 'width', maskHeight: 'height', maskFeather: 'feather',
        };
        const maskKey = maskPropMap[prop];
        if (!maskKey || !clip.mask) return;
        const kfs = clip.keyframes?.[prop as AnimatableProp];
        if (kfs && kfs.length > 0) {
          const existing = kfs.find((k) => Math.abs(k.time - clipLocalTime) < 0.02);
          if (existing) {
            updateKeyframe(clip.id, prop as AnimatableProp, existing.id, { value: val });
          } else {
            addKeyframe(clip.id, prop as AnimatableProp, clipLocalTime, val, 'linear');
          }
        } else {
          updateClip(clip.id, { mask: { ...clip.mask, [maskKey]: val } });
        }
      }
    },
    [clip, clipLocalTime, updateClip, addKeyframe, updateKeyframe]
  );

  const addAllKeyframes = useEditorStore((s) => s.addAllKeyframes);

  const handleAddAllKeyframes = useCallback(() => {
    if (!clip) return;
    addAllKeyframes(clip.id, clipLocalTime, {
      x: animatedValues.x,
      y: animatedValues.y,
      scale: animatedValues.scale,
      scaleX: animatedValues.scaleX,
      scaleY: animatedValues.scaleY,
      maskCenterX: animatedValues.maskCenterX,
      maskCenterY: animatedValues.maskCenterY,
      maskWidth: animatedValues.maskWidth,
      maskHeight: animatedValues.maskHeight,
      maskFeather: animatedValues.maskFeather,
    } as Record<AnimatableProp, number>, 'linear');
  }, [clip, clipLocalTime, animatedValues, addAllKeyframes]);

  const handleResetTransform = useCallback(() => {
    if (!clip) return;
    updateClip(clip.id, { x: 0, y: 0, scale: 1, scaleX: 1, scaleY: 1, keyframes: undefined, keyframeIdCounter: undefined });
  }, [clip, updateClip]);

  const handleMaskShapeChange = useCallback((shape: MaskShape) => {
    if (!clip) return;
    if (shape === 'none') {
      // Remove mask and mask keyframes
      const newKfs = clip.keyframes ? { ...clip.keyframes } : undefined;
      if (newKfs) {
        for (const p of MASK_ANIMATABLE_PROPS) delete newKfs[p];
      }
      updateClip(clip.id, { mask: undefined, keyframes: newKfs && Object.keys(newKfs).length > 0 ? newKfs : undefined });
    } else {
      updateClip(clip.id, { mask: clip.mask ? { ...clip.mask, shape } : defaultMask(shape) });
    }
  }, [clip, updateClip]);

  const handleMaskInvert = useCallback((invert: boolean) => {
    if (!clip?.mask) return;
    updateClip(clip.id, { mask: { ...clip.mask, invert } });
  }, [clip, updateClip]);

  const handleMaskBorderRadius = useCallback((val: number) => {
    if (!clip?.mask) return;
    updateClip(clip.id, { mask: { ...clip.mask, borderRadius: Math.max(0, Math.min(0.5, val)) } });
  }, [clip, updateClip]);

  const handleResetMask = useCallback(() => {
    if (!clip) return;
    const newKfs = clip.keyframes ? { ...clip.keyframes } : undefined;
    if (newKfs) {
      for (const p of MASK_ANIMATABLE_PROPS) delete newKfs[p];
    }
    updateClip(clip.id, { mask: undefined, keyframes: newKfs && Object.keys(newKfs).length > 0 ? newKfs : undefined });
  }, [clip, updateClip]);

  // Collect all keyframes grouped by timestamp
  const keyframeGroups = useMemo(() => {
    if (!clip?.keyframes) return [];
    const timeMap = new Map<string, { time: number; entries: { prop: AnimatableProp; kf: Keyframe }[] }>();
    for (const prop of ['x', 'y', 'scale', 'scaleX', 'scaleY', ...MASK_ANIMATABLE_PROPS] as AnimatableProp[]) {
      const kfs = clip.keyframes[prop];
      if (kfs) {
        for (const kf of kfs) {
          const key = kf.time.toFixed(3);
          if (!timeMap.has(key)) {
            timeMap.set(key, { time: kf.time, entries: [] });
          }
          timeMap.get(key)!.entries.push({ prop, kf });
        }
      }
    }
    return Array.from(timeMap.values()).sort((a, b) => a.time - b.time);
  }, [clip?.keyframes]);

  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  const toggleGroup = useCallback((timeKey: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(timeKey)) next.delete(timeKey);
      else next.add(timeKey);
      return next;
    });
  }, []);

  const handleComponentPropChange = useCallback(
    (key: string, value: any) => {
      if (!clip) return;
      updateClip(clip.id, {
        componentProps: { ...(clip.componentProps || {}), [key]: value },
      });
    },
    [clip, updateClip],
  );

  const renderTransformRow = (label: string, prop: AnimatableProp, step: string, min?: string) => {
    if (!clip) return null;
    const kfs = clip.keyframes?.[prop];
    const maskPropMap: Record<string, keyof ClipMask> = {
      maskCenterX: 'centerX', maskCenterY: 'centerY',
      maskWidth: 'width', maskHeight: 'height', maskFeather: 'feather',
    };
    const isMaskProp = prop in maskPropMap;
    const baseValue = isMaskProp ? ((clip.mask as any)?.[maskPropMap[prop]] ?? 0) : (clip as any)[prop];
    const displayValue = (kfs && kfs.length > 0)
      ? animatedValues[prop].toFixed(2)
      : (baseValue as number).toFixed(2);

    return (
      <div className="property-row">
        <span className="property-label">{label}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <KeyframeButton
            clipId={clip.id}
            prop={prop}
            keyframes={kfs}
            currentValue={animatedValues[prop]}
            clipLocalTime={clipLocalTime}
          />
          <input
            className="property-input"
            type="number"
            step={step}
            min={min}
            value={displayValue}
            onChange={(e) => handleChange(prop, e.target.value)}
          />
        </div>
      </div>
    );
  };

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
            </div>

            {clipMedia?.type === 'component' && clipMedia.propDefinitions && Object.keys(clipMedia.propDefinitions).length > 0 && (
              <div className="property-group">
                <div className="property-group-title">Component Props</div>
                {Object.entries(clipMedia.propDefinitions).map(([key, def]) => {
                  const value = clip!.componentProps?.[key] ?? def.default;
                  return (
                    <div className="property-row" key={key}>
                      <span className="property-label">{def.label}</span>
                      {def.type === 'string' && (
                        <input
                          className="property-input"
                          type="text"
                          value={value}
                          onChange={(e) => handleComponentPropChange(key, e.target.value)}
                        />
                      )}
                      {def.type === 'number' && (
                        <input
                          className="property-input"
                          type="number"
                          step={def.step ?? 1}
                          min={def.min}
                          max={def.max}
                          value={value}
                          onChange={(e) => handleComponentPropChange(key, parseFloat(e.target.value) || 0)}
                        />
                      )}
                      {def.type === 'color' && (
                        <input
                          type="color"
                          value={value}
                          onChange={(e) => handleComponentPropChange(key, e.target.value)}
                          style={{ width: 48, height: 24, border: 'none', background: 'transparent', cursor: 'pointer' }}
                        />
                      )}
                      {def.type === 'boolean' && (
                        <input
                          type="checkbox"
                          checked={!!value}
                          onChange={(e) => handleComponentPropChange(key, e.target.checked)}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            )}

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

            <div className="property-group">
                  <div className="property-group-title">
                    Transform
                    <button className="property-reset-btn" onClick={handleAddAllKeyframes} title="Add keyframe for all properties at current time">
                      Key All
                    </button>
                    <button className="property-reset-btn" onClick={handleResetTransform} title="Reset transform">
                      Reset
                    </button>
                  </div>
                  {renderTransformRow('X', 'x', '0.01')}
                  {renderTransformRow('Y', 'y', '0.01')}
                  {renderTransformRow('Scale', 'scale', '0.05', '0.1')}
                  {renderTransformRow('Scale X', 'scaleX', '0.05', '0.1')}
                  {renderTransformRow('Scale Y', 'scaleY', '0.05', '0.1')}
                </div>

                <div className="property-group">
                  <div className="property-group-title">
                    Mask
                    {clip.mask && (
                      <button className="property-reset-btn" onClick={handleResetMask} title="Reset mask">
                        Reset
                      </button>
                    )}
                  </div>
                  <div className="property-row">
                    <span className="property-label">Shape</span>
                    <div className="mask-shape-selector">
                      {MASK_SHAPES.map((s) => (
                        <button
                          key={s}
                          className={`mask-shape-btn${(clip.mask?.shape ?? 'none') === s ? ' active' : ''}`}
                          onClick={() => handleMaskShapeChange(s)}
                        >
                          {s === 'none' ? 'None' : s === 'rectangle' ? 'Rect' : 'Ellipse'}
                        </button>
                      ))}
                    </div>
                  </div>
                  {clip.mask && clip.mask.shape !== 'none' && (
                    <>
                      {renderTransformRow('Center X', 'maskCenterX', '0.01')}
                      {renderTransformRow('Center Y', 'maskCenterY', '0.01')}
                      {renderTransformRow('Width', 'maskWidth', '0.01', '0.01')}
                      {renderTransformRow('Height', 'maskHeight', '0.01', '0.01')}
                      {renderTransformRow('Feather', 'maskFeather', '1', '0')}
                      {clip.mask.shape === 'rectangle' && (
                        <div className="property-row">
                          <span className="property-label">Radius</span>
                          <input
                            className="property-input"
                            type="number"
                            step="0.01"
                            min="0"
                            max="0.5"
                            value={clip.mask.borderRadius.toFixed(2)}
                            onChange={(e) => handleMaskBorderRadius(parseFloat(e.target.value) || 0)}
                          />
                        </div>
                      )}
                      <div className="property-row">
                        <span className="property-label">Invert</span>
                        <input
                          type="checkbox"
                          checked={clip.mask.invert}
                          onChange={(e) => handleMaskInvert(e.target.checked)}
                        />
                      </div>
                    </>
                  )}
                </div>

                {keyframeGroups.length > 0 && (
                  <div className="property-group">
                    <div className="property-group-title">Keyframes</div>
                    <div className="keyframe-list">
                      {keyframeGroups.map((group) => {
                        const timeKey = group.time.toFixed(3);
                        const isCollapsed = !expandedGroups.has(timeKey);
                        return (
                          <div key={timeKey} className="keyframe-group">
                            <button
                              className="keyframe-group-header"
                              onClick={() => toggleGroup(timeKey)}
                            >
                              <span className={`keyframe-group-chevron${isCollapsed ? '' : ' open'}`}>&#9654;</span>
                              <span className="keyframe-group-time">{formatTime(group.time)}</span>
                              <span className="keyframe-group-count">{group.entries.length} prop{group.entries.length !== 1 ? 's' : ''}</span>
                            </button>
                            {!isCollapsed && (
                              <div className="keyframe-group-body">
                                {group.entries.map(({ prop, kf }) => (
                                  <div key={`${prop}-${kf.id}`} className="keyframe-row">
                                    <span className="keyframe-prop-label">{prop.toUpperCase()}</span>
                                    <input
                                      className="property-input keyframe-time-input"
                                      type="number"
                                      step="0.1"
                                      min="0"
                                      value={kf.time.toFixed(2)}
                                      title="Time (s)"
                                      onChange={(e) =>
                                        updateKeyframe(clip.id, prop, kf.id, {
                                          time: Math.max(0, parseFloat(e.target.value) || 0),
                                        })
                                      }
                                    />
                                    <input
                                      className="property-input keyframe-value-input"
                                      type="number"
                                      step={prop === 'scale' ? '0.05' : '0.01'}
                                      value={kf.value.toFixed(2)}
                                      title="Value"
                                      onChange={(e) =>
                                        updateKeyframe(clip.id, prop, kf.id, {
                                          value: parseFloat(e.target.value) || 0,
                                        })
                                      }
                                    />
                                    <select
                                      className="easing-select"
                                      value={kf.easing}
                                      onChange={(e) =>
                                        updateKeyframe(clip.id, prop, kf.id, {
                                          easing: e.target.value as EasingType,
                                        })
                                      }
                                    >
                                      {EASING_OPTIONS.map((opt) => (
                                        <option key={opt} value={opt}>
                                          {EASING_LABELS[opt]}
                                        </option>
                                      ))}
                                    </select>
                                    <button
                                      className="keyframe-delete-btn"
                                      onClick={() => removeKeyframe(clip.id, prop, kf.id)}
                                      title="Delete keyframe"
                                    >
                                      &times;
                                    </button>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
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
