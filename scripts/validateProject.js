const { z } = require('zod');
const fs = require('fs');
const path = require('path');

// --- Zod schemas (moved from src/schemas/projectSchemas.ts) ---

const maskShapeSchema = z.enum(['none', 'rectangle', 'ellipse']);

const clipMaskSchema = z.object({
  shape: maskShapeSchema,
  centerX: z.number().min(0).max(1),
  centerY: z.number().min(0).max(1),
  width: z.number().min(0).max(1),
  height: z.number().min(0).max(1),
  rotation: z.number(),
  feather: z.number().min(0),
  borderRadius: z.number().min(0).max(0.5),
  invert: z.boolean(),
});

const animatablePropSchema = z.enum([
  'x', 'y', 'scale', 'scaleX', 'scaleY',
  'maskCenterX', 'maskCenterY', 'maskWidth', 'maskHeight', 'maskFeather',
]);

const easingTypeSchema = z.enum(['linear', 'ease-in', 'ease-out', 'ease-in-out']);

const keyframeSchema = z.object({
  id: z.number().int().nonnegative(),
  time: z.number().min(0),
  value: z.number(),
  easing: easingTypeSchema,
});

const keyframeMapSchema = z.record(animatablePropSchema, z.array(keyframeSchema)).optional();

const mediaTypeSchema = z.enum(['video', 'audio']);

const mediaFileSchema = z.object({
  path: z.string().min(1),
  name: z.string().min(1),
  ext: z.string().min(1),
  type: mediaTypeSchema,
  duration: z.number().nonnegative(),
});

const timelineClipSchema = z.object({
  id: z.number().int().nonnegative(),
  mediaPath: z.string().min(1),
  mediaName: z.string().min(1),
  type: mediaTypeSchema,
  track: z.number().int(),
  startTime: z.number().min(0),
  duration: z.number().positive(),
  trimStart: z.number().min(0),
  trimEnd: z.number().min(0),
  originalDuration: z.number().positive(),
  x: z.number(),
  y: z.number(),
  scale: z.number(),
  scaleX: z.number(),
  scaleY: z.number(),
  keyframes: keyframeMapSchema,
  keyframeIdCounter: z.number().int().nonnegative().optional(),
  mask: clipMaskSchema.optional(),
});

const exportSettingsSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  fps: z.number().positive(),
  bitrate: z.number().positive(),
});

const projectDataSchema = z.object({
  version: z.number().int().positive(),
  name: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  tracks: z.array(z.number().int()),
  trackIdCounter: z.number().int().nonnegative(),
  clipIdCounter: z.number().int().nonnegative(),
  exportSettings: exportSettingsSchema,
  mediaFiles: z.array(mediaFileSchema),
  timelineClips: z.array(timelineClipSchema),
});

// --- Validation function ---

/**
 * Validate project data against schemas and integrity rules.
 * @param {unknown} data - Parsed project JSON
 * @param {string} [projectDir] - Optional project directory for disk-existence checks
 * @returns {{ structureErrors: string[], integrityErrors: string[], warnings: string[] }}
 */
function validateProject(data, projectDir) {
  const structureErrors = [];
  const integrityErrors = [];
  const warnings = [];

  // Zod structure validation
  const result = projectDataSchema.safeParse(data);
  if (!result.success) {
    for (const issue of result.error.issues) {
      const p = issue.path.join('.');
      structureErrors.push(`${p || '(root)'}: ${issue.message}`);
    }
  }

  // Referential integrity checks (only if basic arrays are present)
  if (!data || typeof data !== 'object') return { structureErrors, integrityErrors, warnings };
  if (!Array.isArray(data.mediaFiles) || !Array.isArray(data.timelineClips) || !Array.isArray(data.tracks)) {
    return { structureErrors, integrityErrors, warnings };
  }

  const mediaPaths = new Set(data.mediaFiles.map((mf) => mf.path));
  const trackSet = new Set(data.tracks);
  const clipIds = new Set();

  for (let i = 0; i < data.timelineClips.length; i++) {
    const clip = data.timelineClips[i];
    if (!clip || typeof clip !== 'object') continue;

    // mediaPath in mediaFiles
    if (clip.mediaPath && !mediaPaths.has(clip.mediaPath)) {
      integrityErrors.push(`timelineClips[${i}].mediaPath "${clip.mediaPath}" not found in mediaFiles`);
    }

    // track exists
    if (typeof clip.track === 'number' && !trackSet.has(clip.track)) {
      integrityErrors.push(`timelineClips[${i}].track ${clip.track} not found in tracks array`);
    }

    // unique clip IDs
    if (typeof clip.id === 'number') {
      if (clipIds.has(clip.id)) {
        integrityErrors.push(`timelineClips[${i}].id ${clip.id} is duplicated`);
      }
      clipIds.add(clip.id);

      // clip ID < clipIdCounter
      if (typeof data.clipIdCounter === 'number' && clip.id >= data.clipIdCounter) {
        integrityErrors.push(`timelineClips[${i}].id ${clip.id} >= clipIdCounter (${data.clipIdCounter})`);
      }
    }

    // trimStart + trimEnd <= originalDuration
    if (typeof clip.trimStart === 'number' && typeof clip.trimEnd === 'number' && typeof clip.originalDuration === 'number') {
      if (clip.trimStart + clip.trimEnd > clip.originalDuration) {
        integrityErrors.push(
          `timelineClips[${i}]: trimStart (${clip.trimStart}) + trimEnd (${clip.trimEnd}) > originalDuration (${clip.originalDuration})`
        );
      }
    }
  }

  // Overlap detection per track
  const clipsByTrack = new Map();
  for (let i = 0; i < data.timelineClips.length; i++) {
    const clip = data.timelineClips[i];
    if (!clip || typeof clip.track !== 'number' || typeof clip.startTime !== 'number' || typeof clip.duration !== 'number') continue;
    const arr = clipsByTrack.get(clip.track) || [];
    arr.push({ index: i, start: clip.startTime, end: clip.startTime + clip.duration });
    clipsByTrack.set(clip.track, arr);
  }
  for (const [track, clips] of clipsByTrack) {
    clips.sort((a, b) => a.start - b.start);
    for (let i = 1; i < clips.length; i++) {
      if (clips[i].start < clips[i - 1].end) {
        integrityErrors.push(
          `Track ${track}: timelineClips[${clips[i - 1].index}] and timelineClips[${clips[i].index}] overlap`
        );
      }
    }
  }

  // Media file existence on disk (only if projectDir provided)
  if (projectDir) {
    for (const mf of data.mediaFiles) {
      if (!mf || typeof mf.path !== 'string') continue;
      const absPath = path.resolve(projectDir, mf.path);
      if (!fs.existsSync(absPath)) {
        warnings.push(`Media file missing on disk: ${mf.path}`);
      }
    }
  }

  return { structureErrors, integrityErrors, warnings };
}

module.exports = { validateProject, projectDataSchema };
