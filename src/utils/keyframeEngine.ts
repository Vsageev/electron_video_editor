import type { Keyframe, EasingType, TimelineClip, AnimatableProp, ClipMask } from '../types';

const easingFns: Record<EasingType, (t: number) => number> = {
  'linear': (t) => t,
  'ease-in': (t) => t * t,
  'ease-out': (t) => t * (2 - t),
  'ease-in-out': (t) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t),
};

export function evaluateKeyframes(
  keyframes: Keyframe[] | undefined,
  time: number,
  fallback: number,
): number {
  if (!keyframes || keyframes.length === 0) return fallback;

  if (time <= keyframes[0].time) return keyframes[0].value;
  if (time >= keyframes[keyframes.length - 1].time) return keyframes[keyframes.length - 1].value;

  for (let i = 0; i < keyframes.length - 1; i++) {
    const a = keyframes[i];
    const b = keyframes[i + 1];
    if (time >= a.time && time <= b.time) {
      const span = b.time - a.time;
      if (span === 0) return a.value;
      const t = (time - a.time) / span;
      const eased = easingFns[a.easing](t);
      return a.value + (b.value - a.value) * eased;
    }
  }

  return fallback;
}

export function getAnimatedMask(
  clip: TimelineClip,
  clipLocalTime: number,
): ClipMask | null {
  const mask = clip.mask;
  if (!mask || mask.shape === 'none') return null;

  const kf = clip.keyframes;
  return {
    shape: mask.shape,
    centerX: evaluateKeyframes(kf?.maskCenterX, clipLocalTime, mask.centerX),
    centerY: evaluateKeyframes(kf?.maskCenterY, clipLocalTime, mask.centerY),
    width: evaluateKeyframes(kf?.maskWidth, clipLocalTime, mask.width),
    height: evaluateKeyframes(kf?.maskHeight, clipLocalTime, mask.height),
    feather: evaluateKeyframes(kf?.maskFeather, clipLocalTime, mask.feather),
    rotation: mask.rotation,
    borderRadius: mask.borderRadius,
    invert: mask.invert,
  };
}

export function getAnimatedTransform(
  clip: TimelineClip,
  clipLocalTime: number,
): { x: number; y: number; scale: number; scaleX: number; scaleY: number } {
  const kf = clip.keyframes;
  return {
    x: evaluateKeyframes(kf?.x, clipLocalTime, clip.x),
    y: evaluateKeyframes(kf?.y, clipLocalTime, clip.y),
    scale: evaluateKeyframes(kf?.scale, clipLocalTime, clip.scale),
    scaleX: evaluateKeyframes(kf?.scaleX, clipLocalTime, clip.scaleX),
    scaleY: evaluateKeyframes(kf?.scaleY, clipLocalTime, clip.scaleY),
  };
}
