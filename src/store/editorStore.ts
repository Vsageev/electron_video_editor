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

function isAbsolutePath(filePath: string): boolean {
  if (!filePath) return false;
  return (
    filePath.startsWith('/') ||
    filePath.startsWith('\\\\') ||
    /^[A-Za-z]:[\\/]/.test(filePath)
  );
}

function toProjectAbsolutePath(filePath: string, projectDir: string | null): string {
  if (!filePath || !projectDir || isAbsolutePath(filePath)) return filePath;
  return `${projectDir}/${filePath}`;
}

function buildMediaLookup(
  mediaFiles: MediaFile[],
  projectDir: string | null,
): Map<string, MediaFile> {
  const map = new Map<string, MediaFile>();
  for (const media of mediaFiles) {
    map.set(media.path, media);
    const rel = toProjectRelativePath(media.path, projectDir);
    if (rel) map.set(rel, media);
    const abs = toProjectAbsolutePath(media.path, projectDir);
    map.set(abs, media);
  }
  return map;
}

function remapComponentMediaRefs(
  componentProps: Record<string, any> | undefined,
  propDefinitions: Record<string, PropDefinition> | undefined,
  mediaLookup: Map<string, MediaFile>,
  mapPath: (value: string) => string,
  depth = 0,
): Record<string, any> | undefined {
  if (!componentProps || !propDefinitions || depth > 8) return componentProps;
  let changed = false;
  const nextProps: Record<string, any> = { ...componentProps };

  for (const [propName, def] of Object.entries(propDefinitions)) {
    if (def.type !== 'media') continue;

    const rawValue = nextProps[propName];
    let selectedValue = rawValue;
    if (typeof rawValue === 'string' && rawValue !== '') {
      const mappedValue = mapPath(rawValue);
      if (mappedValue !== rawValue) {
        nextProps[propName] = mappedValue;
        changed = true;
      }
      selectedValue = mappedValue;
    }

    const childPropsKey = `${propName}:props`;
    const childPropsRaw = nextProps[childPropsKey];
    if (!childPropsRaw || typeof childPropsRaw !== 'object' || Array.isArray(childPropsRaw)) continue;
    if (typeof selectedValue !== 'string' || selectedValue === '') continue;

    const selectedMedia = mediaLookup.get(selectedValue);
    if (!selectedMedia || selectedMedia.type !== 'component' || !selectedMedia.propDefinitions) continue;

    const mappedChildProps = remapComponentMediaRefs(
      childPropsRaw as Record<string, any>,
      selectedMedia.propDefinitions,
      mediaLookup,
      mapPath,
      depth + 1,
    );
    if (mappedChildProps !== childPropsRaw) {
      nextProps[childPropsKey] = mappedChildProps;
      changed = true;
    }
  }

  return changed ? nextProps : componentProps;
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
  selectedClipIds: number[];
  clipIdCounter: number;
  addClip: (media: MediaFile) => void;
  addClipAtTime: (media: MediaFile, track: number, startTime: number) => void;
  removeClip: (clipId: number) => void;
  removeSelectedClips: () => void;
  updateClip: (clipId: number, updates: Partial<TimelineClip>) => void;
  selectClip: (clipId: number | null, opts?: { toggle?: boolean }) => void;

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

  // Zoom (timeline)
  zoom: number;
  setZoom: (zoom: number) => void;

  // Canvas zoom/pan (preview panel)
  canvasZoom: number;
  canvasPanX: number;
  canvasPanY: number;
  setCanvasZoom: (zoom: number) => void;
  setCanvasPan: (x: number, y: number) => void;
  resetCanvasView: () => void;

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

  // Subtitle generation
  isGeneratingSubtitles: boolean;
  subtitleProgress: string;
  generateSubtitles: (clipId: number) => Promise<void>;
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
    const remainingIds = new Set(remainingClips.map((c) => c.id));
    const selectedClipIds = s.selectedClipIds.filter((id) => remainingIds.has(id));

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
      selectedClipIds,
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
  selectedClipIds: [],
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
        rotation: 0,
        ...(componentProps ? { componentProps } : {}),
      };
      return {
        timelineClips: [...s.timelineClips, clip],
        clipIdCounter: newId,
        selectedClipIds: [newId],
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
        rotation: 0,
        ...(componentProps ? { componentProps } : {}),
      };
      return {
        timelineClips: [...s.timelineClips, clip],
        clipIdCounter: newId,
        selectedClipIds: [newId],
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
        selectedClipIds: s.selectedClipIds.filter((id) => id !== clipId),
      };
    }),
  removeSelectedClips: () =>
    set((s) => {
      if (s.selectedClipIds.length === 0) return s;
      const idsToRemove = new Set(s.selectedClipIds);
      let remaining = s.timelineClips.filter((c) => !idsToRemove.has(c.id));
      if (s.rippleEnabled) {
        for (const clipId of idsToRemove) {
          const removed = s.timelineClips.find((c) => c.id === clipId);
          if (removed) {
            remaining = remaining.map((c) =>
              c.track === removed.track && c.startTime > removed.startTime
                ? { ...c, startTime: c.startTime - removed.duration }
                : c,
            );
          }
        }
      }
      return { timelineClips: remaining, selectedClipIds: [] };
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
  selectClip: (clipId, opts) => set((s) => {
    if (clipId === null) return { selectedClipIds: [] };
    if (opts?.toggle) {
      const idx = s.selectedClipIds.indexOf(clipId);
      if (idx >= 0) {
        return { selectedClipIds: s.selectedClipIds.filter((id) => id !== clipId) };
      }
      return { selectedClipIds: [...s.selectedClipIds, clipId] };
    }
    return { selectedClipIds: [clipId] };
  }),

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

  // Zoom (timeline)
  zoom: 100,
  setZoom: (zoom) => set({ zoom: Math.max(20, Math.min(300, zoom)) }),

  // Canvas zoom/pan
  canvasZoom: 1,
  canvasPanX: 0,
  canvasPanY: 0,
  setCanvasZoom: (z) => set({ canvasZoom: Math.max(0.1, Math.min(5, z)) }),
  setCanvasPan: (x, y) => set({ canvasPanX: x, canvasPanY: y }),
  resetCanvasView: () => set({ canvasZoom: 1, canvasPanX: 0, canvasPanY: 0 }),

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
      const { selectedClipIds, currentTime } = s;
      if (selectedClipIds.length === 0) return s;
      const selectedClipId = selectedClipIds[selectedClipIds.length - 1];
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
        selectedClipIds: [newId],
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
        selectedClipIds: [],
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
          path: toProjectAbsolutePath(mf.path, dir),
          ...(mf.bundlePath ? { bundlePath: toProjectAbsolutePath(mf.bundlePath, dir) } : {}),
        };
        if (resolved.propDefinitions) {
          for (const def of Object.values(resolved.propDefinitions)) {
            if ((def as any).type === 'component') (def as any).type = 'media';
          }
        }
        return resolved;
      });
      const resolvedMediaLookup = buildMediaLookup(resolvedMedia, dir);
      const resolvedClips = data.timelineClips.map((c) => {
        const mediaPath = toProjectAbsolutePath(c.mediaPath, dir);
        const clipMedia = resolvedMediaLookup.get(mediaPath) ?? resolvedMediaLookup.get(c.mediaPath);
        const componentProps = remapComponentMediaRefs(
          c.componentProps,
          clipMedia?.propDefinitions,
          resolvedMediaLookup,
          (value) => toProjectAbsolutePath(value, dir),
        );
        return {
          ...c,
          mediaPath,
          ...(componentProps ? { componentProps } : {}),
        };
      });

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
        selectedClipIds: [],
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
      const relativeMediaLookup = buildMediaLookup(relativeMedia, dir);
      const relativeClips = s.timelineClips.map((c) => {
        const mediaPath = c.mediaPath.startsWith(dir + '/') ? c.mediaPath.slice(dir.length + 1) : c.mediaPath;
        const clipMedia = relativeMediaLookup.get(mediaPath) ?? relativeMediaLookup.get(c.mediaPath);
        const componentProps = remapComponentMediaRefs(
          c.componentProps,
          clipMedia?.propDefinitions,
          relativeMediaLookup,
          (value) => toProjectRelativePath(value, dir) ?? value,
        );
        return {
          ...c,
          mediaPath,
          ...(componentProps ? { componentProps } : {}),
        };
      });

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

  // Subtitle generation
  isGeneratingSubtitles: false,
  subtitleProgress: '',
  generateSubtitles: async (clipId) => {
    const s = get();
    if (!s.currentProject || !s.projectDir) {
      set({ projectError: 'No project open' });
      return;
    }

    const clip = s.timelineClips.find((c) => c.id === clipId);
    if (!clip) return;

    const media = s.mediaFiles.find((m) => m.path === clip.mediaPath);
    if (!media || (media.type !== 'video' && media.type !== 'audio')) {
      set({ projectError: 'Subtitles can only be generated for video or audio clips' });
      return;
    }

    // Check API key
    try {
      const keys = await window.api.getApiKeys();
      if (!keys.OPENAI_API_KEY) {
        set({ projectError: 'OPENAI_API_KEY not set. Configure it in Settings.' });
        return;
      }
    } catch {
      set({ projectError: 'Failed to read API keys' });
      return;
    }

    set({ isGeneratingSubtitles: true, subtitleProgress: 'Starting...' });

    // Subscribe to progress events
    const unsub = window.api.onTranscribeProgress((msg: string) => {
      set({ subtitleProgress: msg });
    });

    try {
      // Get relative media path
      const prefix = s.projectDir + '/';
      const relativePath = media.path.startsWith(prefix)
        ? media.path.slice(prefix.length)
        : media.path;

      const result = await window.api.transcribeAudio(s.currentProject, relativePath);

      if (!result.success || !result.segments || result.segments.length === 0) {
        set({ projectError: result.error || 'No speech detected in this clip' });
        return;
      }

      // Ensure TextOverlay built-in is in project
      let textOverlayMedia = s.mediaFiles.find(
        (m) => m.type === 'component' && m.name === 'TextOverlay',
      );

      if (!textOverlayMedia) {
        const addResult = await window.api.addBuiltinComponent(s.currentProject, 'TextOverlay.tsx');
        if (!addResult.success) {
          set({ projectError: `Failed to add TextOverlay component: ${addResult.error}` });
          return;
        }

        const fullBundlePath = s.projectDir + '/' + addResult.bundlePath;
        let propDefinitions;
        try {
          const { loadComponent } = await import('../utils/componentLoader');
          const entry = await loadComponent(fullBundlePath);
          propDefinitions = entry.propDefinitions;
        } catch { /* ignore */ }

        textOverlayMedia = {
          path: s.projectDir + '/' + addResult.sourcePath,
          name: 'TextOverlay',
          ext: '.tsx',
          type: 'component' as const,
          duration: 5,
          bundlePath: fullBundlePath,
          ...(propDefinitions ? { propDefinitions } : {}),
        };

        // Add to media files
        set((prev) => ({
          mediaFiles: [...prev.mediaFiles.filter((m) => m.path !== textOverlayMedia!.path), textOverlayMedia!],
        }));
      }

      // Re-read state after potential media additions
      const current = get();
      const exportHeight = current.exportSettings.height;

      // Create a new track for subtitles
      const newTrackId = current.trackIdCounter + 1;
      let nextClipId = current.clipIdCounter;

      const newClips: TimelineClip[] = [];

      for (const seg of result.segments) {
        // Map Whisper timestamps to timeline: clip.startTime - clip.trimStart + segment time
        const timelineStart = clip.startTime - clip.trimStart + seg.start;
        const timelineEnd = clip.startTime - clip.trimStart + seg.end;

        // Clamp to clip's visible range
        const clipVisibleStart = clip.startTime;
        const clipVisibleEnd = clip.startTime + clip.duration;

        const clampedStart = Math.max(timelineStart, clipVisibleStart);
        const clampedEnd = Math.min(timelineEnd, clipVisibleEnd);
        const segDuration = clampedEnd - clampedStart;

        if (segDuration <= 0.05) continue;

        nextClipId += 1;
        newClips.push({
          id: nextClipId,
          mediaPath: textOverlayMedia.path,
          mediaName: 'TextOverlay',
          track: newTrackId,
          startTime: clampedStart,
          duration: segDuration,
          trimStart: 0,
          trimEnd: 0,
          originalDuration: segDuration,
          x: 0,
          y: 0.4,
          scale: 1,
          scaleX: 1,
          scaleY: 1,
          rotation: 0,
          componentProps: {
            text: seg.text,
            color: '#ffffff',
            backgroundColor: 'rgba(0,0,0,0.6)',
          },
        });
      }

      if (newClips.length === 0) {
        set({ projectError: 'No speech segments found within the clip range' });
        return;
      }

      set((prev) => ({
        tracks: [newTrackId, ...prev.tracks],
        trackIdCounter: newTrackId,
        timelineClips: [...prev.timelineClips, ...newClips],
        clipIdCounter: nextClipId,
      }));
    } catch (err: any) {
      set({ projectError: `Subtitle generation failed: ${err.message}` });
    } finally {
      unsub();
      set({ isGeneratingSubtitles: false, subtitleProgress: '' });
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
      selectedClipIds: [],
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
