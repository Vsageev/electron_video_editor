import { useCallback, useMemo, useState } from 'react';
import { useEditorStore } from '../store/editorStore';
import { formatTime } from '../utils/formatTime';
import { evaluateKeyframes } from '../utils/keyframeEngine';
import DraggableNumberInput from './DraggableNumberInput';
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

function finiteNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function formatFixed(value: unknown, digits: number, fallback = 0): string {
  return finiteNumber(value, fallback).toFixed(digits);
}

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
          : 'Add keyframe'
      }
    >
      <span className="keyframe-diamond" />
    </button>
  );
}

export default function PropertiesSidebar() {
  const { timelineClips, selectedClipIds, updateClip, mediaFiles } = useEditorStore();
  const currentTime = useEditorStore((s) => s.currentTime);
  const addKeyframe = useEditorStore((s) => s.addKeyframe);
  const updateKeyframe = useEditorStore((s) => s.updateKeyframe);
  const removeKeyframe = useEditorStore((s) => s.removeKeyframe);
  const isMultiSelect = selectedClipIds.length > 1;
  const clip = isMultiSelect ? undefined : timelineClips.find((c) => c.id === selectedClipIds[0]);
  const clipMedia = clip ? mediaFiles.find((m) => m.path === clip.mediaPath) : undefined;
  const mediaRefOptions = useMemo(
    () => mediaFiles.filter((m) => m.path !== clip?.mediaPath),
    [mediaFiles, clip?.mediaPath],
  );

  const clipLocalTime = clip ? currentTime - clip.startTime : 0;

  const animatedValues = useMemo(() => {
    if (!clip) return { x: 0, y: 0, scale: 1, scaleX: 1, scaleY: 1, rotation: 0, maskCenterX: 0.5, maskCenterY: 0.5, maskWidth: 0.8, maskHeight: 0.8, maskFeather: 0 };
    const m = clip.mask;
    return {
      x: evaluateKeyframes(clip.keyframes?.x, clipLocalTime, finiteNumber(clip.x, 0)),
      y: evaluateKeyframes(clip.keyframes?.y, clipLocalTime, finiteNumber(clip.y, 0)),
      scale: evaluateKeyframes(clip.keyframes?.scale, clipLocalTime, finiteNumber(clip.scale, 1)),
      scaleX: evaluateKeyframes(clip.keyframes?.scaleX, clipLocalTime, finiteNumber(clip.scaleX, 1)),
      scaleY: evaluateKeyframes(clip.keyframes?.scaleY, clipLocalTime, finiteNumber(clip.scaleY, 1)),
      rotation: evaluateKeyframes(clip.keyframes?.rotation, clipLocalTime, clip.rotation ?? 0),
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
      } else if (prop === 'duration') {
        const duration = Math.max(0.1, val);
        // For looped clips, only update duration (keep originalDuration as source length)
        if (clip.looped) {
          updateClip(clip.id, { duration });
        } else {
          updateClip(clip.id, { duration, originalDuration: duration });
        }
      } else if (prop === 'trimStart') {
        const trimStart = Math.max(0, Math.min(val, clip.originalDuration - clip.trimEnd - 0.1));
        const duration = clip.originalDuration - trimStart - clip.trimEnd;
        updateClip(clip.id, { trimStart, duration });
      } else if (prop === 'trimEnd') {
        const trimEnd = Math.max(0, Math.min(val, clip.originalDuration - clip.trimStart - 0.1));
        const duration = clip.originalDuration - clip.trimStart - trimEnd;
        updateClip(clip.id, { trimEnd, duration });
      } else if (prop === 'x' || prop === 'y' || prop === 'scale' || prop === 'scaleX' || prop === 'scaleY' || prop === 'rotation') {
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
      rotation: animatedValues.rotation,
      maskCenterX: animatedValues.maskCenterX,
      maskCenterY: animatedValues.maskCenterY,
      maskWidth: animatedValues.maskWidth,
      maskHeight: animatedValues.maskHeight,
      maskFeather: animatedValues.maskFeather,
    } as Record<AnimatableProp, number>, 'linear');
  }, [clip, clipLocalTime, animatedValues, addAllKeyframes]);

  const handleResetTransform = useCallback(() => {
    if (!clip) return;
    updateClip(clip.id, { x: 0, y: 0, scale: 1, scaleX: 1, scaleY: 1, rotation: 0, flipX: false, flipY: false, keyframes: undefined, keyframeIdCounter: undefined });
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
    for (const prop of ['x', 'y', 'scale', 'scaleX', 'scaleY', 'rotation', ...MASK_ANIMATABLE_PROPS] as AnimatableProp[]) {
      const kfs = clip.keyframes[prop];
      if (kfs) {
        for (const kf of kfs) {
          if (!Number.isFinite(kf.time) || !Number.isFinite(kf.value)) continue;
          const key = formatFixed(kf.time, 3);
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
    const propDefaults: Record<AnimatableProp, number> = {
      x: 0,
      y: 0,
      scale: 1,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      maskCenterX: 0.5,
      maskCenterY: 0.5,
      maskWidth: 0.8,
      maskHeight: 0.8,
      maskFeather: 0,
    };
    const maskPropMap: Record<string, keyof ClipMask> = {
      maskCenterX: 'centerX', maskCenterY: 'centerY',
      maskWidth: 'width', maskHeight: 'height', maskFeather: 'feather',
    };
    const isMaskProp = prop in maskPropMap;
    const defaultValue = propDefaults[prop];
    const baseValue = isMaskProp
      ? finiteNumber((clip.mask as any)?.[maskPropMap[prop]], defaultValue)
      : finiteNumber((clip as any)[prop], defaultValue);
    const displayValue = (kfs && kfs.length > 0)
      ? formatFixed(animatedValues[prop], 2, defaultValue)
      : formatFixed(baseValue, 2, defaultValue);

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
          <DraggableNumberInput
            step={parseFloat(step)}
            min={min !== undefined ? parseFloat(min) : undefined}
            value={displayValue}
            onChange={(v) => handleChange(prop, String(v))}
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
        {isMultiSelect ? (
          <div className="properties-empty">
            <p>{selectedClipIds.length} clips selected</p>
          </div>
        ) : !clip ? (
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
                  const enumValue = def.type === 'enum' && def.options.includes(String(value))
                    ? String(value)
                    : def.type === 'enum'
                      ? def.default
                      : '';
                  const mediaValue = def.type === 'media' && mediaRefOptions.some((m) => m.path === String(value))
                    ? String(value)
                    : def.type === 'media'
                      ? ''
                      : '';
                  const selectedRefMedia = def.type === 'media' && mediaValue
                    ? mediaFiles.find((m) => m.path === mediaValue)
                    : undefined;
                  const childPropDefs = selectedRefMedia?.type === 'component' && selectedRefMedia.propDefinitions
                    ? selectedRefMedia.propDefinitions
                    : undefined;
                  const childPropsKey = `${key}:props`;
                  const childProps = clip!.componentProps?.[childPropsKey] as Record<string, any> | undefined;

                  return (
                    <div key={key}>
                      <div className="property-row">
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
                          <DraggableNumberInput
                            step={def.step ?? 1}
                            min={def.min}
                            max={def.max}
                            value={value}
                            onChange={(v) => handleComponentPropChange(key, v)}
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
                        {def.type === 'enum' && (
                          <select
                            className="property-input"
                            value={enumValue}
                            onChange={(e) => handleComponentPropChange(key, e.target.value)}
                          >
                            {def.options.map((option) => (
                              <option key={option} value={option}>
                                {option}
                              </option>
                            ))}
                          </select>
                        )}
                        {def.type === 'media' && (
                          <select
                            className="property-input"
                            value={mediaValue}
                            onChange={(e) => handleComponentPropChange(key, e.target.value)}
                          >
                            <option value="">None</option>
                            {mediaRefOptions.map((media) => (
                              <option key={media.path} value={media.path}>
                                {media.name} ({media.type})
                              </option>
                            ))}
                          </select>
                        )}
                      </div>
                      {def.type === 'media' && childPropDefs && Object.keys(childPropDefs).length > 0 && (
                        <div className="property-group" style={{ marginLeft: 12, borderLeft: '2px solid var(--border-color, #444)', paddingLeft: 8 }}>
                          <div className="property-group-title" style={{ fontSize: 11 }}>{selectedRefMedia!.name} Props</div>
                          {Object.entries(childPropDefs).map(([childKey, childDef]) => {
                            if (childDef.type === 'media') return null; // no recursive nesting
                            const childVal = childProps?.[childKey] ?? childDef.default;
                            const childEnumValue = childDef.type === 'enum' && childDef.options.includes(String(childVal))
                              ? String(childVal) : childDef.type === 'enum' ? childDef.default : '';
                            return (
                              <div className="property-row" key={childKey}>
                                <span className="property-label">{childDef.label}</span>
                                {childDef.type === 'string' && (
                                  <input className="property-input" type="text" value={childVal}
                                    onChange={(e) => handleComponentPropChange(childPropsKey, { ...(childProps || {}), [childKey]: e.target.value })} />
                                )}
                                {childDef.type === 'number' && (
                                  <DraggableNumberInput
                                    step={childDef.step ?? 1} min={childDef.min} max={childDef.max} value={childVal}
                                    onChange={(v) => handleComponentPropChange(childPropsKey, { ...(childProps || {}), [childKey]: v })} />
                                )}
                                {childDef.type === 'color' && (
                                  <input type="color" value={childVal}
                                    onChange={(e) => handleComponentPropChange(childPropsKey, { ...(childProps || {}), [childKey]: e.target.value })}
                                    style={{ width: 48, height: 24, border: 'none', background: 'transparent', cursor: 'pointer' }} />
                                )}
                                {childDef.type === 'boolean' && (
                                  <input type="checkbox" checked={!!childVal}
                                    onChange={(e) => handleComponentPropChange(childPropsKey, { ...(childProps || {}), [childKey]: e.target.checked })} />
                                )}
                                {childDef.type === 'enum' && (
                                  <select className="property-input" value={childEnumValue}
                                    onChange={(e) => handleComponentPropChange(childPropsKey, { ...(childProps || {}), [childKey]: e.target.value })}>
                                    {childDef.options.map((opt) => (<option key={opt} value={opt}>{opt}</option>))}
                                  </select>
                                )}
                              </div>
                            );
                          })}
                        </div>
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
                <DraggableNumberInput
                  step={0.1}
                  min={0}
                  value={formatFixed(clip.startTime, 2)}
                  onChange={(v) => handleChange('startTime', String(v))}
                />
              </div>
              <div className="property-row">
                <span className="property-label">Duration</span>
                {clipMedia?.type === 'component' || clipMedia?.type === 'image' || clip.looped ? (
                  <DraggableNumberInput
                    step={0.1}
                    min={0.1}
                    value={formatFixed(clip.duration, 2, 0.1)}
                    onChange={(v) => handleChange('duration', String(v))}
                  />
                ) : (
                  <span className="property-value">{formatTime(clip.duration)}</span>
                )}
              </div>
              {clipMedia?.type !== 'component' && clipMedia?.type !== 'image' && (
                <>
                  <div className="property-row">
                    <span className="property-label">Original</span>
                    <span className="property-value">{formatTime(clip.originalDuration)}</span>
                  </div>
                  <div className="property-row">
                    <span className="property-label">Loop</span>
                    <input
                      type="checkbox"
                      checked={!!clip.looped}
                      onChange={(e) => updateClip(clip.id, { looped: e.target.checked })}
                    />
                  </div>
                </>
              )}
            </div>

            <div className="property-group">
                  <div className="property-group-title">
                    Transform
                    <button className="property-reset-btn" onClick={handleAddAllKeyframes} title="Key all properties">
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
                  {renderTransformRow('Rotation', 'rotation', '1')}
                  <div className="property-row">
                    <span className="property-label">Flip</span>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button
                        className={`flip-toggle-btn${clip.flipX ? ' active' : ''}`}
                        onClick={() => updateClip(clip.id, { flipX: !clip.flipX })}
                        title="Flip Horizontal"
                      >
                        H
                      </button>
                      <button
                        className={`flip-toggle-btn${clip.flipY ? ' active' : ''}`}
                        onClick={() => updateClip(clip.id, { flipY: !clip.flipY })}
                        title="Flip Vertical"
                      >
                        V
                      </button>
                    </div>
                  </div>
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
                          <DraggableNumberInput
                            step={0.01}
                            min={0}
                            max={0.5}
                            value={formatFixed(clip.mask.borderRadius, 2)}
                            onChange={(v) => handleMaskBorderRadius(v)}
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
                        const timeKey = formatFixed(group.time, 3);
                        const isCollapsed = !expandedGroups.has(timeKey);
                        return (
                          <div key={timeKey} className="keyframe-group">
                            <div className="keyframe-group-header-row">
                              <button
                                className="keyframe-group-header"
                                onClick={() => toggleGroup(timeKey)}
                              >
                                <span className={`keyframe-group-chevron${isCollapsed ? '' : ' open'}`}>&#9654;</span>
                                <span className="keyframe-group-time">{formatTime(group.time)}</span>
                                <span className="keyframe-group-count">{group.entries.length} prop{group.entries.length !== 1 ? 's' : ''}</span>
                              </button>
                              <button
                                className="keyframe-delete-btn"
                                onClick={() => {
                                  for (const { prop, kf } of group.entries) {
                                    removeKeyframe(clip.id, prop, kf.id);
                                  }
                                }}
                                title="Delete all keyframes at this time"
                              >
                                &times;
                              </button>
                            </div>
                            {!isCollapsed && (
                              <div className="keyframe-group-body">
                                {group.entries.map(({ prop, kf }) => (
                                  <div key={`${prop}-${kf.id}`} className="keyframe-row">
                                    <span className="keyframe-prop-label">{prop.toUpperCase()}</span>
                                    <DraggableNumberInput
                                      className="property-input keyframe-time-input"
                                      step={0.1}
                                      min={0}
                                      value={formatFixed(kf.time, 2)}
                                      title="Time (s)"
                                      onChange={(v) =>
                                        updateKeyframe(clip.id, prop, kf.id, { time: v })
                                      }
                                    />
                                    <DraggableNumberInput
                                      className="property-input keyframe-value-input"
                                      step={prop === 'scale' ? 0.05 : 0.01}
                                      value={formatFixed(kf.value, 2)}
                                      title="Value"
                                      onChange={(v) =>
                                        updateKeyframe(clip.id, prop, kf.id, { value: v })
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

            {clipMedia?.type !== 'component' && clipMedia?.type !== 'image' && (
              <div className="property-group">
                <div className="property-group-title">Trim</div>
                <div className="property-row">
                  <span className="property-label">Trim Start</span>
                  <DraggableNumberInput
                    step={0.1}
                    min={0}
                    value={formatFixed(clip.trimStart, 2)}
                    onChange={(v) => handleChange('trimStart', String(v))}
                  />
                </div>
                <div className="property-row">
                  <span className="property-label">Trim End</span>
                  <DraggableNumberInput
                    step={0.1}
                    min={0}
                    value={formatFixed(clip.trimEnd, 2)}
                    onChange={(v) => handleChange('trimEnd', String(v))}
                  />
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </aside>
  );
}
