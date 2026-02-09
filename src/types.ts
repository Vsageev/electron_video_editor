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

declare global {
  interface Window {
    api: {
      openFileDialog: () => Promise<{ path: string; name: string; ext: string }[]>;
      exportDialog: () => Promise<string | null>;
      getMediaDuration?: (filePath: string) => Promise<number>;
      saveBlob: (outputPath: string, buffer: ArrayBuffer) => Promise<{ success: boolean; error?: string }>;
      readFile: (filePath: string) => Promise<ArrayBuffer>;
    };
  }
}
