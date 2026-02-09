import { create } from 'zustand';
import type { MediaFile, TimelineClip, AnimatableProp, EasingType, Keyframe } from '../types';

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

  // Keyframes
  addKeyframe: (clipId: number, prop: AnimatableProp, time: number, value: number, easing: EasingType) => void;
  addAllKeyframes: (clipId: number, time: number, values: Record<AnimatableProp, number>, easing: EasingType) => void;
  updateKeyframe: (clipId: number, prop: AnimatableProp, kfId: number, updates: Partial<Pick<Keyframe, 'time' | 'value' | 'easing'>>) => void;
  removeKeyframe: (clipId: number, prop: AnimatableProp, kfId: number) => void;

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
  showExportSettings: boolean;
  setShowExportSettings: (v: boolean) => void;
  exportSettings: { width: number; height: number; fps: number; bitrate: number };
  setExportSettings: (s: Partial<{ width: number; height: number; fps: number; bitrate: number }>) => void;

  // Clip splitting
  splitClipAtPlayhead: () => void;

  // Ripple edit
  rippleEnabled: boolean;
  toggleRipple: () => void;

  // Settings
  showSettings: boolean;
  setShowSettings: (v: boolean) => void;
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
        scaleX: 1,
        scaleY: 1,
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
        scaleX: 1,
        scaleY: 1,
      };
      return {
        timelineClips: [...s.timelineClips, clip],
        clipIdCounter: newId,
        selectedClipId: newId,
      };
    }),
  removeClip: (clipId) =>
    set((s) => {
      const removed = s.timelineClips.find((c) => c.id === clipId);
      let remaining = s.timelineClips.filter((c) => c.id !== clipId);
      if (removed && s.rippleEnabled) {
        const shift = removed.duration;
        remaining = remaining.map((c) =>
          c.track === removed.track && c.startTime > removed.startTime
            ? { ...c, startTime: c.startTime - shift }
            : c,
        );
      }
      return {
        timelineClips: remaining,
        selectedClipId: s.selectedClipId === clipId ? null : s.selectedClipId,
      };
    }),
  updateClip: (clipId, updates) =>
    set((s) => ({
      timelineClips: s.timelineClips.map((c) => (c.id === clipId ? { ...c, ...updates } : c)),
    })),
  selectClip: (clipId) => set({ selectedClipId: clipId }),

  // Keyframes
  addKeyframe: (clipId, prop, time, value, easing) =>
    set((s) => ({
      timelineClips: s.timelineClips.map((c) => {
        if (c.id !== clipId) return c;
        const kf = { ...c.keyframes };
        const arr = [...(kf[prop] || [])];
        const newId = (c.keyframeIdCounter || 0) + 1;
        arr.push({ id: newId, time, value, easing });
        arr.sort((a, b) => a.time - b.time);
        kf[prop] = arr;
        return { ...c, keyframes: kf, keyframeIdCounter: newId };
      }),
    })),

  addAllKeyframes: (clipId, time, values, easing) =>
    set((s) => ({
      timelineClips: s.timelineClips.map((c) => {
        if (c.id !== clipId) return c;
        const kf = { ...c.keyframes };
        let counter = c.keyframeIdCounter || 0;
        for (const prop of Object.keys(values) as AnimatableProp[]) {
          const arr = [...(kf[prop] || [])];
          // Skip if keyframe already exists at this time
          if (arr.some((k) => Math.abs(k.time - time) < 0.02)) continue;
          counter += 1;
          arr.push({ id: counter, time, value: values[prop], easing });
          arr.sort((a, b) => a.time - b.time);
          kf[prop] = arr;
        }
        return { ...c, keyframes: kf, keyframeIdCounter: counter };
      }),
    })),

  updateKeyframe: (clipId, prop, kfId, updates) =>
    set((s) => ({
      timelineClips: s.timelineClips.map((c) => {
        if (c.id !== clipId) return c;
        const kf = { ...c.keyframes };
        const arr = (kf[prop] || []).map((k) =>
          k.id === kfId ? { ...k, ...updates } : k,
        );
        arr.sort((a, b) => a.time - b.time);
        kf[prop] = arr;
        return { ...c, keyframes: kf };
      }),
    })),

  removeKeyframe: (clipId, prop, kfId) =>
    set((s) => ({
      timelineClips: s.timelineClips.map((c) => {
        if (c.id !== clipId) return c;
        const kf = { ...c.keyframes };
        const arr = (kf[prop] || []).filter((k) => k.id !== kfId);
        if (arr.length === 0) {
          delete kf[prop];
        } else {
          kf[prop] = arr;
        }
        const hasAny = Object.keys(kf).length > 0;
        return { ...c, keyframes: hasAny ? kf : undefined };
      }),
    })),

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
  showExportSettings: false,
  setShowExportSettings: (v) => set({ showExportSettings: v }),
  exportSettings: { width: 1920, height: 1080, fps: 30, bitrate: 8_000_000 },
  setExportSettings: (s) =>
    set((state) => ({ exportSettings: { ...state.exportSettings, ...s } })),

  // Clip splitting
  splitClipAtPlayhead: () =>
    set((s) => {
      const { selectedClipId, currentTime } = s;
      if (selectedClipId == null) return s;
      const clip = s.timelineClips.find((c) => c.id === selectedClipId);
      if (!clip) return s;

      const clipEnd = clip.startTime + clip.duration;
      // Playhead must be strictly inside the clip (not at edges)
      if (currentTime <= clip.startTime || currentTime >= clipEnd) return s;

      const leftDuration = currentTime - clip.startTime;
      const rightDuration = clipEnd - currentTime;

      // Left clip: modify the existing clip in place
      const leftClip: TimelineClip = {
        ...clip,
        duration: leftDuration,
        trimEnd: clip.originalDuration - clip.trimStart - leftDuration,
      };

      // Right clip: new clip
      const newId = s.clipIdCounter + 1;
      const rightClip: TimelineClip = {
        ...clip,
        id: newId,
        startTime: currentTime,
        duration: rightDuration,
        trimStart: clip.trimStart + leftDuration,
        trimEnd: clip.trimEnd,
      };

      return {
        timelineClips: s.timelineClips.map((c) => (c.id === clip.id ? leftClip : c)).concat(rightClip),
        clipIdCounter: newId,
        selectedClipId: newId,
      };
    }),

  // Ripple edit
  rippleEnabled: false,
  toggleRipple: () => set((s) => ({ rippleEnabled: !s.rippleEnabled })),

  // Settings
  showSettings: false,
  setShowSettings: (v) => set({ showSettings: v }),
}));
