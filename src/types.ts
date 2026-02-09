export type MaskShape = 'none' | 'rectangle' | 'ellipse';

export interface ClipMask {
  shape: MaskShape;
  centerX: number;  // 0–1 normalized, 0.5 = centered
  centerY: number;
  width: number;    // 0–1 normalized, 1.0 = full clip width
  height: number;
  rotation: number; // degrees
  feather: number;  // pixels blur radius
  borderRadius: number; // rectangle only, 0–0.5 fraction
  invert: boolean;
}

export type AnimatableProp = 'x' | 'y' | 'scale' | 'scaleX' | 'scaleY' | 'maskCenterX' | 'maskCenterY' | 'maskWidth' | 'maskHeight' | 'maskFeather';
export type EasingType = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out';

export interface Keyframe {
  id: number;
  time: number;       // seconds relative to clip start
  value: number;
  easing: EasingType; // easing to NEXT keyframe
}

export type KeyframeMap = Partial<Record<AnimatableProp, Keyframe[]>>;

export interface MediaFile {
  path: string;
  name: string;
  ext: string;
  type: 'video' | 'audio';
  duration: number;
}

export interface TimelineClip {
  id: number;
  mediaPath: string;
  mediaName: string;
  type: 'video' | 'audio';
  track: number;
  startTime: number;
  duration: number;
  trimStart: number;
  trimEnd: number;
  originalDuration: number;
  // Canvas transform
  x: number;
  y: number;
  scale: number;
  scaleX: number;
  scaleY: number;
  // Keyframe animation
  keyframes?: KeyframeMap;
  keyframeIdCounter?: number;
  // Shape mask
  mask?: ClipMask;
}

export interface ContextMenuItem {
  label?: string;
  action?: () => void;
  danger?: boolean;
  divider?: boolean;
}

declare global {
  interface Window {
    api: {
      openFileDialog: () => Promise<{ path: string; name: string; ext: string }[]>;
      exportDialog: () => Promise<string | null>;
      getMediaDuration?: (filePath: string) => Promise<number>;
      saveBlob: (outputPath: string, buffer: ArrayBuffer) => Promise<{ success: boolean; error?: string }>;
      readFile: (filePath: string) => Promise<ArrayBuffer>;
      getApiKeys: () => Promise<Record<string, string>>;
      setApiKeys: (keys: Record<string, string>) => Promise<{ success: boolean }>;
    };
  }
}
