import { create } from 'zustand';
import type { MediaFile, TimelineClip, AnimatableProp, EasingType, Keyframe, ProjectData, PropDefinition } from '../types';

function toProjectRelativePath(filePath: string, projectDir: string | null): string | null {
  if (!filePath || !projectDir) return null;
  // Renderer may run on Windows (backslashes) while project data is stored with '/'.
  const norm = (p: string) => p.replaceAll('\\', '/').replace(/\/+$/, '');
  const fp = norm(filePath);
  const dir = norm(projectDir);
  return fp.startsWith(dir + '/') ? fp.slice(dir.length + 1) : null;
}

function buildDefaultComponentProps(
  propDefinitions?: Record<string, PropDefinition>,
): Record<string, any> | undefined {
  if (!propDefinitions) return undefined;
  const props: Record<string, any> = {};
  for (const [key, def] of Object.entries(propDefinitions)) {
    props[key] = def.default;
  }
  return Object.keys(props).length > 0 ? props : undefined;
}

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
  previewMediaType: 'video' | 'audio' | 'component' | 'image' | null;
  setPreviewMedia: (path: string | null, type?: 'video' | 'audio' | 'component' | 'image') => void;

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
  autoSnapEnabled: boolean;
  toggleAutoSnap: () => void;

  // Media metadata
  mediaMetadata: Record<string, string>;  // mediaPath -> md content
  mediaMetadataLoading: boolean;
  loadMediaMetadata: (mediaPath: string) => Promise<void>;
  saveMediaMetadata: (mediaPath: string, content: string) => Promise<void>;

  // Settings
  showSettings: boolean;
  setShowSettings: (v: boolean) => void;

  // Project
  currentProject: string | null;
  isSaving: boolean;
  projectError: string | null;
  projectWarnings: string[];
  projectDir: string | null;
  createProject: (name: string) => Promise<void>;
  openProject: (name: string) => Promise<void>;
  saveProject: () => Promise<void>;
  setProjectError: (msg: string | null) => void;
  clearProjectWarnings: () => void;
  closeProject: () => void;
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
  removeMediaFile: (index) => {
    const s = get();
    const media = s.mediaFiles[index];
    if (!media) return;

    // Remove clips that reference this media
    const mediaPath = media.path;
    const remainingClips = s.timelineClips
      .filter((c) => c.mediaPath !== mediaPath)
      .map((clip) => {
        if (!clip.componentProps) return clip;
        const clipMedia = s.mediaFiles.find((mf) => mf.path === clip.mediaPath);
        const defs = clipMedia?.propDefinitions;
        if (!defs) return clip;

        let changed = false;
        const nextProps = { ...clip.componentProps };
        for (const [key, val] of Object.entries(nextProps)) {
          if (defs[key]?.type === 'media' && val === mediaPath) {
            nextProps[key] = '';
            changed = true;
          }
        }
        return changed ? { ...clip, componentProps: nextProps } : clip;
      });
    const selectedClipId =
      s.selectedClipId != null && !remainingClips.some((c) => c.id === s.selectedClipId)
        ? null
        : s.selectedClipId;

    const nextSelectedMediaIndex =
      s.selectedMediaIndex == null
        ? null
        : s.selectedMediaIndex === index
          ? null
          : s.selectedMediaIndex > index
            ? s.selectedMediaIndex - 1
            : s.selectedMediaIndex;

    const shouldClearPreview = s.previewMediaPath === mediaPath;
    const nextPreviewMediaPath = shouldClearPreview ? null : s.previewMediaPath;
    const nextPreviewMediaType = shouldClearPreview ? null : s.previewMediaType;

    // Clear cached metadata for removed media (and bundle, if any).
    const nextMediaMetadata = { ...s.mediaMetadata };
    delete nextMediaMetadata[mediaPath];
    if (media.bundlePath) delete nextMediaMetadata[media.bundlePath];

    set({
      mediaFiles: s.mediaFiles.filter((_, i) => i !== index),
      selectedMediaIndex: nextSelectedMediaIndex,
      timelineClips: remainingClips,
      selectedClipId,
      previewMediaPath: nextPreviewMediaPath,
      previewMediaType: nextPreviewMediaType,
      mediaMetadata: nextMediaMetadata,
    });

    // Delete file from project media folder
    if (s.currentProject && s.projectDir) {
      const rel = toProjectRelativePath(mediaPath, s.projectDir);
      if (rel) {
        window.api.deleteMediaFromProject(s.currentProject, rel).catch(() => {});
      }
      // Components also generate a bundled JS file in the project media folder.
      if (media.bundlePath) {
        const relBundle = toProjectRelativePath(media.bundlePath, s.projectDir);
        if (relBundle) {
          window.api.deleteMediaFromProject(s.currentProject, relBundle).catch(() => {});
        }
      }
    }
  },
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
      const componentProps = buildDefaultComponentProps(media.propDefinitions);
      const clip: TimelineClip = {
        id: newId,
        mediaPath: media.path,
        mediaName: media.name,
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
        ...(componentProps ? { componentProps } : {}),
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
      const componentProps = buildDefaultComponentProps(media.propDefinitions);
      const clip: TimelineClip = {
        id: newId,
        mediaPath: media.path,
        mediaName: media.name,
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
        ...(componentProps ? { componentProps } : {}),
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
    set((s) => {
      const clip = s.timelineClips.find((c) => c.id === clipId);
      if (!clip) return s;

      const nextClip: TimelineClip = { ...clip, ...updates };
      const placementChanged =
        updates.track !== undefined || updates.startTime !== undefined || updates.duration !== undefined;

      if (placementChanged) {
        const trackClips = s.timelineClips.filter((c) => c.track === nextClip.track);
        if (hasOverlap(trackClips, nextClip.startTime, nextClip.duration, clipId)) {
          return s;
        }
      }

      return {
        timelineClips: s.timelineClips.map((c) => (c.id === clipId ? nextClip : c)),
      };
    }),
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

      // Determine if this is a flex-duration clip (component/image)
      const media = s.mediaFiles.find((m) => m?.path === clip.mediaPath);
      const isFlexDuration = media?.type === 'component' || media?.type === 'image';

      // Left clip: modify the existing clip in place
      const leftClip: TimelineClip = isFlexDuration
        ? { ...clip, duration: leftDuration, originalDuration: leftDuration, trimStart: 0, trimEnd: 0 }
        : { ...clip, duration: leftDuration, trimEnd: clip.originalDuration - clip.trimStart - leftDuration };

      // Right clip: new clip
      const newId = s.clipIdCounter + 1;
      const rightClip: TimelineClip = isFlexDuration
        ? { ...clip, id: newId, startTime: currentTime, duration: rightDuration, originalDuration: rightDuration, trimStart: 0, trimEnd: 0 }
        : { ...clip, id: newId, startTime: currentTime, duration: rightDuration, trimStart: clip.trimStart + leftDuration, trimEnd: clip.trimEnd };

      return {
        timelineClips: s.timelineClips.map((c) => (c.id === clip.id ? leftClip : c)).concat(rightClip),
        clipIdCounter: newId,
        selectedClipId: newId,
      };
    }),

  // Ripple edit
  rippleEnabled: false,
  toggleRipple: () => set((s) => ({ rippleEnabled: !s.rippleEnabled })),
  autoSnapEnabled: true,
  toggleAutoSnap: () => set((s) => ({ autoSnapEnabled: !s.autoSnapEnabled })),

  // Media metadata
  mediaMetadata: {},
  mediaMetadataLoading: false,
  loadMediaMetadata: async (mediaPath) => {
    set({ mediaMetadataLoading: true });
    try {
      const content = await window.api.readMediaMetadata(mediaPath);
      set((s) => ({
        mediaMetadata: { ...s.mediaMetadata, [mediaPath]: content },
        mediaMetadataLoading: false,
      }));
    } catch {
      set({ mediaMetadataLoading: false });
    }
  },
  saveMediaMetadata: async (mediaPath, content) => {
    const result = await window.api.writeMediaMetadata(mediaPath, content);
    if (result.success) {
      set((s) => ({
        mediaMetadata: { ...s.mediaMetadata, [mediaPath]: content },
      }));
    }
  },

  // Settings
  showSettings: false,
  setShowSettings: (v) => set({ showSettings: v }),

  // Project
  currentProject: null,
  isSaving: false,
  projectError: null,
  projectWarnings: [],
  projectDir: null,
  setProjectError: (msg) => set({ projectError: msg }),
  clearProjectWarnings: () => set({ projectWarnings: [] }),

  createProject: async (name) => {
    try {
      await window.api.createProject(name);
      const dir = await window.api.getProjectDir(name);
      set({
        currentProject: name,
        projectDir: dir,
        projectError: null,
        projectWarnings: [],
        mediaFiles: [],
        timelineClips: [],
        tracks: [1, 2],
        trackIdCounter: 2,
        clipIdCounter: 0,
        selectedClipId: null,
        selectedMediaIndex: null,
        currentTime: 0,
        isPlaying: false,
      });
      await window.api.setLastProject(name);
      // Save initial empty project
      await get().saveProject();
      // Start watching for external changes
      await window.api.watchProject(name);
    } catch (err: any) {
      set({ projectError: err.message || 'Failed to create project' });
    }
  },

  openProject: async (name) => {
    try {
      const result = await window.api.loadProject(name);
      if (!result.success || !result.data) {
        set({ projectError: result.error || 'Failed to load project' });
        return;
      }
      const data = result.data;
      const dir = await window.api.getProjectDir(name);

      // Resolve relative media paths to absolute and migrate legacy 'component' prop type to 'media'
      const resolvedMedia = data.mediaFiles.map((mf) => {
        const resolved = {
          ...mf,
          path: dir + '/' + mf.path,
          ...(mf.bundlePath ? { bundlePath: dir + '/' + mf.bundlePath } : {}),
        };
        if (resolved.propDefinitions) {
          for (const def of Object.values(resolved.propDefinitions)) {
            if ((def as any).type === 'component') (def as any).type = 'media';
          }
        }
        return resolved;
      });
      const resolvedClips = data.timelineClips.map((c) => ({
        ...c,
        mediaPath: dir + '/' + c.mediaPath,
      }));

      set({
        currentProject: name,
        projectDir: dir,
        projectError: null,
        projectWarnings: result.warnings || [],
        mediaFiles: resolvedMedia,
        timelineClips: resolvedClips,
        tracks: data.tracks,
        trackIdCounter: data.trackIdCounter,
        clipIdCounter: data.clipIdCounter,
        exportSettings: data.exportSettings,
        selectedClipId: null,
        selectedMediaIndex: null,
        currentTime: 0,
        isPlaying: false,
      });
      await window.api.setLastProject(name);
      // Start watching for external changes
      await window.api.watchProject(name);
    } catch (err: any) {
      set({ projectError: err.message || 'Failed to open project' });
    }
  },

  saveProject: async () => {
    const s = get();
    if (!s.currentProject || s.isSaving) return;
    set({ isSaving: true });
    try {
      const dir = s.projectDir || '';

      // Convert absolute paths back to relative for storage
      const relativeMedia = s.mediaFiles.map((mf) => ({
        ...mf,
        path: mf.path.startsWith(dir + '/') ? mf.path.slice(dir.length + 1) : mf.path,
        ...(mf.bundlePath ? { bundlePath: mf.bundlePath.startsWith(dir + '/') ? mf.bundlePath.slice(dir.length + 1) : mf.bundlePath } : {}),
      }));
      const relativeClips = s.timelineClips.map((c) => ({
        ...c,
        mediaPath: c.mediaPath.startsWith(dir + '/') ? c.mediaPath.slice(dir.length + 1) : c.mediaPath,
      }));

      // Try loading existing project to preserve createdAt
      let createdAt: string;
      try {
        const existing = await window.api.loadProject(s.currentProject);
        createdAt = existing.data?.createdAt || new Date().toISOString();
      } catch {
        createdAt = new Date().toISOString();
      }

      const projectData: ProjectData = {
        version: 1,
        name: s.currentProject,
        createdAt,
        updatedAt: new Date().toISOString(),
        tracks: s.tracks,
        trackIdCounter: s.trackIdCounter,
        clipIdCounter: s.clipIdCounter,
        exportSettings: s.exportSettings,
        mediaFiles: relativeMedia,
        timelineClips: relativeClips,
      };

      const result = await window.api.saveProject(s.currentProject, projectData);
      if (!result.success) {
        set({ projectError: `Save failed: ${result.error}` });
      }
    } catch (err: any) {
      set({ projectError: `Save failed: ${err.message}` });
    } finally {
      set({ isSaving: false });
    }
  },

  closeProject: () => {
    window.api.unwatchProject();
    set({
      currentProject: null,
      projectDir: null,
      projectError: null,
      projectWarnings: [],
      mediaFiles: [],
      timelineClips: [],
      tracks: [1, 2],
      trackIdCounter: 2,
      clipIdCounter: 0,
      selectedClipId: null,
      selectedMediaIndex: null,
      currentTime: 0,
      isPlaying: false,
    });
  },
}));

// ---------------------------------------------------------------------------
// Auto-save: debounced subscription to persistent state changes
// ---------------------------------------------------------------------------

let autoSaveTimer: ReturnType<typeof setTimeout> | null = null;

// Fields that trigger auto-save when changed
function getPersistentSnapshot(s: EditorState) {
  return {
    mediaFiles: s.mediaFiles,
    timelineClips: s.timelineClips,
    tracks: s.tracks,
    trackIdCounter: s.trackIdCounter,
    clipIdCounter: s.clipIdCounter,
    exportSettings: s.exportSettings,
  };
}

let lastSnapshot = JSON.stringify(getPersistentSnapshot(useEditorStore.getState()));

useEditorStore.subscribe((state) => {
  if (!state.currentProject) return;

  const snapshot = JSON.stringify(getPersistentSnapshot(state));
  if (snapshot === lastSnapshot) return;
  lastSnapshot = snapshot;

  if (autoSaveTimer) clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => {
    useEditorStore.getState().saveProject();
  }, 2000);
});

// ---------------------------------------------------------------------------
// External file change: reload project when project.json is edited outside
// ---------------------------------------------------------------------------

window.api.onProjectFileChanged(() => {
  const s = useEditorStore.getState();
  if (!s.currentProject || s.isSaving) return;
  // Re-open the project to pick up external changes
  s.openProject(s.currentProject).then(() => {
    // Update the auto-save snapshot so we don't immediately re-save
    lastSnapshot = JSON.stringify(getPersistentSnapshot(useEditorStore.getState()));
  });
});
