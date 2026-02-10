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

export interface PropDefinition {
  type: 'string' | 'number' | 'color' | 'boolean';
  default: any;
  label: string;
  min?: number;
  max?: number;
  step?: number;
}

export interface MediaFile {
  path: string;
  name: string;
  ext: string;
  type: 'video' | 'audio' | 'component';
  duration: number;
  bundlePath?: string;
  propDefinitions?: Record<string, PropDefinition>;
}

export interface TimelineClip {
  id: number;
  mediaPath: string;
  mediaName: string;
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
  // Component custom props
  componentProps?: Record<string, any>;
}

export interface ComponentClipProps {
  currentTime: number;
  duration: number;
  width: number;
  height: number;
  progress: number;
  [key: string]: any;
}

export interface ProjectData {
  version: number;
  name: string;
  createdAt: string;
  updatedAt: string;
  tracks: number[];
  trackIdCounter: number;
  clipIdCounter: number;
  exportSettings: { width: number; height: number; fps: number; bitrate: number };
  mediaFiles: MediaFile[];
  timelineClips: TimelineClip[];
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
      // Project management
      listProjects: () => Promise<string[]>;
      createProject: (name: string) => Promise<{ success: boolean }>;
      loadProject: (name: string) => Promise<{ success: boolean; data?: ProjectData; warnings?: string[]; error?: string }>;
      saveProject: (name: string, data: ProjectData) => Promise<{ success: boolean; error?: string }>;
      copyMediaToProject: (projectName: string, sourcePath: string) => Promise<{ success: boolean; relativePath?: string }>;
      deleteMediaFromProject: (projectName: string, relativePath: string) => Promise<{ success: boolean; error?: string }>;
      getLastProject: () => Promise<string | null>;
      setLastProject: (name: string) => Promise<void>;
      deleteProject: (name: string) => Promise<{ success: boolean; error?: string }>;
      getProjectDir: (name: string) => Promise<string>;
      // Media metadata
      readMediaMetadata: (mediaFilePath: string) => Promise<string>;
      writeMediaMetadata: (mediaFilePath: string, content: string) => Promise<{ success: boolean; error?: string }>;
      // Component bundling
      bundleComponent: (projectName: string, sourcePath: string) => Promise<{ success: boolean; bundlePath?: string; error?: string }>;

      // Built-in components
      listBuiltinComponents: () => Promise<{ name: string; fileName: string }[]>;
      addBuiltinComponent: (projectName: string, fileName: string) => Promise<{ success: boolean; sourcePath?: string; bundlePath?: string; error?: string }>;

      // Project file watching
      watchProject: (name: string) => Promise<void>;
      unwatchProject: () => Promise<void>;
      onProjectFileChanged: (callback: () => void) => () => void;
    };
  }
}
