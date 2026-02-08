import { create } from 'zustand';
import type { MediaFile, TimelineClip } from '../types';

function hasOverlap(
  trackClips: TimelineClip[],
  startTime: number,
  duration: number,
  excludeClipId?: number
): boolean {
  const end = startTime + duration;
  return trackClips.some((c) => {
    if (excludeClipId !== undefined && c.id === excludeClipId) return false;
    const cEnd = c.startTime + c.duration;
    return startTime < cEnd && end > c.startTime;
  });
}

interface EditorState {
  // Media
  mediaFiles: MediaFile[];
  selectedMediaIndex: number | null;
  addMediaFiles: (files: MediaFile[]) => void;
  removeMediaFile: (index: number) => void;
  selectMedia: (index: number | null) => void;

  // Preview (standalone media preview when no timeline clips)
  previewMediaPath: string | null;
  previewMediaType: 'video' | 'audio' | null;
  setPreviewMedia: (path: string | null, type?: 'video' | 'audio') => void;

  // Tracks
  tracks: number[];
  trackIdCounter: number;
  addTrack: () => void;
  removeTrack: (trackId: number) => void;

  // Timeline clips
  timelineClips: TimelineClip[];
  selectedClipId: number | null;
  clipIdCounter: number;
  addClip: (media: MediaFile) => void;
  addClipAtTime: (media: MediaFile, track: number, startTime: number) => void;
  removeClip: (clipId: number) => void;
  updateClip: (clipId: number, updates: Partial<TimelineClip>) => void;
  selectClip: (clipId: number | null) => void;

  // Playback
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  setIsPlaying: (playing: boolean) => void;
  setCurrentTime: (time: number) => void;
  setDuration: (duration: number) => void;

  // Zoom
  zoom: number;
  setZoom: (zoom: number) => void;

  // Export
  isExporting: boolean;
  exportProgress: number;
  setIsExporting: (v: boolean) => void;
  setExportProgress: (v: number) => void;
}

export const useEditorStore = create<EditorState>((set, get) => ({
  // Media
  mediaFiles: [],
  selectedMediaIndex: null,
  addMediaFiles: (files) =>
    set((s) => ({
      mediaFiles: [
        ...s.mediaFiles,
        ...files.filter((f) => !s.mediaFiles.some((m) => m.path === f.path)),
      ],
    })),
  removeMediaFile: (index) =>
    set((s) => ({
      mediaFiles: s.mediaFiles.filter((_, i) => i !== index),
      selectedMediaIndex: s.selectedMediaIndex === index ? null : s.selectedMediaIndex,
    })),
  selectMedia: (index) => set({ selectedMediaIndex: index }),

  // Preview
  previewMediaPath: null,
  previewMediaType: null,
  setPreviewMedia: (path, type) => set({ previewMediaPath: path, previewMediaType: type ?? null }),

  // Tracks
  tracks: [1, 2],
  trackIdCounter: 2,
  addTrack: () =>
    set((s) => {
      const newId = s.trackIdCounter + 1;
      return { tracks: [...s.tracks, newId], trackIdCounter: newId };
    }),
  removeTrack: (trackId) =>
    set((s) => ({
      tracks: s.tracks.filter((id) => id !== trackId),
      timelineClips: s.timelineClips.filter((c) => c.track !== trackId),
    })),

  // Timeline clips
  timelineClips: [],
  selectedClipId: null,
  clipIdCounter: 0,
  addClip: (media) =>
    set((s) => {
      // Find first track where clip can be appended without overlap
      let targetTrack = s.tracks[0];
      for (const trackId of s.tracks) {
        const trackClips = s.timelineClips.filter((c) => c.track === trackId);
        const endTime = trackClips.reduce((max, c) => Math.max(max, c.startTime + c.duration), 0);
        if (!hasOverlap(trackClips, endTime, media.duration)) {
          targetTrack = trackId;
          break;
        }
      }

      const trackClips = s.timelineClips.filter((c) => c.track === targetTrack);
      const startTime = trackClips.reduce((max, c) => Math.max(max, c.startTime + c.duration), 0);
      const newId = s.clipIdCounter + 1;
      const clip: TimelineClip = {
        id: newId,
        mediaPath: media.path,
        mediaName: media.name,
        type: media.type,
        track: targetTrack,
        startTime,
        duration: media.duration,
        trimStart: 0,
        trimEnd: 0,
        originalDuration: media.duration,
        x: 0,
        y: 0,
        scale: 1,
      };
      return {
        timelineClips: [...s.timelineClips, clip],
        clipIdCounter: newId,
        selectedClipId: newId,
      };
    }),
  addClipAtTime: (media, track, startTime) =>
    set((s) => {
      const trackClips = s.timelineClips.filter((c) => c.track === track);
      if (hasOverlap(trackClips, startTime, media.duration)) {
        return s;
      }
      const newId = s.clipIdCounter + 1;
      const clip: TimelineClip = {
        id: newId,
        mediaPath: media.path,
        mediaName: media.name,
        type: media.type,
        track,
        startTime,
        duration: media.duration,
        trimStart: 0,
        trimEnd: 0,
        originalDuration: media.duration,
        x: 0,
        y: 0,
        scale: 1,
      };
      return {
        timelineClips: [...s.timelineClips, clip],
        clipIdCounter: newId,
        selectedClipId: newId,
      };
    }),
  removeClip: (clipId) =>
    set((s) => ({
      timelineClips: s.timelineClips.filter((c) => c.id !== clipId),
      selectedClipId: s.selectedClipId === clipId ? null : s.selectedClipId,
    })),
  updateClip: (clipId, updates) =>
    set((s) => ({
      timelineClips: s.timelineClips.map((c) => (c.id === clipId ? { ...c, ...updates } : c)),
    })),
  selectClip: (clipId) => set({ selectedClipId: clipId }),

  // Playback
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  setIsPlaying: (playing) => set({ isPlaying: playing }),
  setCurrentTime: (time) => set({ currentTime: time }),
  setDuration: (duration) => set({ duration }),

  // Zoom
  zoom: 100,
  setZoom: (zoom) => set({ zoom: Math.max(20, Math.min(300, zoom)) }),

  // Export
  isExporting: false,
  exportProgress: 0,
  setIsExporting: (v) => set({ isExporting: v }),
  setExportProgress: (v) => set({ exportProgress: v }),
}));
