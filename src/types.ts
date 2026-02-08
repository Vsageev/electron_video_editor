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
}

export interface ContextMenuItem {
  label?: string;
  action?: () => void;
  danger?: boolean;
  divider?: boolean;
}

export interface ExportOptions {
  outputPath: string;
  clips: TimelineClip[];
  width: number;
  height: number;
  fps: number;
}

declare global {
  interface Window {
    api: {
      openFileDialog: () => Promise<{ path: string; name: string; ext: string }[]>;
      exportDialog: () => Promise<string | null>;
      getMediaDuration?: (filePath: string) => Promise<number>;
      exportVideo: (options: ExportOptions) => Promise<{ success: boolean; error?: string }>;
      cancelExport: () => Promise<void>;
      onExportProgress: (callback: (data: { percent: number }) => void) => void;
      removeExportProgressListener: () => void;
    };
  }
}
