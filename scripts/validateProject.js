const { z } = require('zod');
const fs = require('fs');
const path = require('path');

// --- Zod schemas (moved from src/schemas/projectSchemas.ts) ---

// Zod's `z.number()` rejects NaN but accepts +/-Infinity unless `.finite()` is used.
const finiteNumber = () => z.number().finite();

const maskShapeSchema = z.enum(['none', 'rectangle', 'ellipse']);

const clipMaskSchema = z.object({
  shape: maskShapeSchema,
  centerX: finiteNumber().min(0).max(1),
  centerY: finiteNumber().min(0).max(1),
  width: finiteNumber().min(0).max(1),
  height: finiteNumber().min(0).max(1),
  rotation: finiteNumber(),
  feather: finiteNumber().min(0),
  borderRadius: finiteNumber().min(0).max(0.5),
  invert: z.boolean(),
});

const animatablePropSchema = z.enum([
  'x', 'y', 'scale', 'scaleX', 'scaleY',
  'maskCenterX', 'maskCenterY', 'maskWidth', 'maskHeight', 'maskFeather',
]);

const easingTypeSchema = z.enum(['linear', 'ease-in', 'ease-out', 'ease-in-out']);

const keyframeSchema = z.object({
  id: z.number().int().nonnegative(),
  time: finiteNumber().min(0),
  value: finiteNumber(),
  easing: easingTypeSchema,
});

const keyframeMapSchema = z.record(animatablePropSchema, z.array(keyframeSchema)).optional();

const mediaTypeSchema = z.enum(['video', 'audio', 'component', 'image']);

const propDefinitionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('string'),
    default: z.string(),
    label: z.string().min(1),
  }),
  z.object({
    type: z.literal('number'),
    default: finiteNumber(),
    label: z.string().min(1),
    min: finiteNumber().optional(),
    max: finiteNumber().optional(),
    step: finiteNumber().optional(),
  }),
  z.object({
    type: z.literal('color'),
    default: z.string(),
    label: z.string().min(1),
  }),
  z.object({
    type: z.literal('boolean'),
    default: z.boolean(),
    label: z.string().min(1),
  }),
  z.object({
    type: z.literal('enum'),
    default: z.string(),
    label: z.string().min(1),
    options: z.array(z.string().min(1)),
  }),
  z.object({
    type: z.enum(['media', 'component']),
    default: z.string(),
    label: z.string().min(1),
  }),
]);

const mediaFileSchema = z.object({
  path: z.string().min(1),
  name: z.string().min(1),
  ext: z.string().min(1),
  type: mediaTypeSchema,
  duration: finiteNumber().nonnegative(),
  bundlePath: z.string().optional(),
  propDefinitions: z.record(z.string().min(1), propDefinitionSchema).optional(),
});

const timelineClipSchema = z.object({
  id: z.number().int().nonnegative(),
  mediaPath: z.string().min(1),
  mediaName: z.string().min(1),
  type: mediaTypeSchema.optional(),  // backwards-compatible: old projects have type, new ones don't
  track: z.number().int(),
  startTime: finiteNumber().min(0),
  duration: finiteNumber().positive(),
  trimStart: finiteNumber().min(0),
  trimEnd: finiteNumber().min(0),
  originalDuration: finiteNumber().positive(),
  x: finiteNumber(),
  y: finiteNumber(),
  scale: finiteNumber(),
  scaleX: finiteNumber(),
  scaleY: finiteNumber(),
  keyframes: keyframeMapSchema,
  keyframeIdCounter: z.number().int().nonnegative().optional(),
  mask: clipMaskSchema.optional(),
  componentProps: z.record(z.any()).optional(),
});

const exportSettingsSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  fps: finiteNumber().positive(),
  bitrate: finiteNumber().positive(),
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

function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function matchesPropType(value, type) {
  if (value == null) return false;
  switch (type) {
    case 'string':
    case 'color':
    case 'enum':
    case 'media':
    case 'component':
      return typeof value === 'string';
    case 'number':
      return isFiniteNumber(value);
    case 'boolean':
      return typeof value === 'boolean';
    default:
      return false;
  }
}

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

  // Build sets defensively so malformed arrays never crash validation.
  const mediaPaths = new Set();
  const mediaByPath = new Map();
  const componentMediaPaths = new Set();
  for (const mf of data.mediaFiles) {
    if (!mf || typeof mf !== 'object') continue;
    if (typeof mf.path === 'string' && mf.path.length > 0) {
      mediaPaths.add(mf.path);
      mediaByPath.set(mf.path, mf);
      if (mf.type === 'component') {
        componentMediaPaths.add(mf.path);
      }
    }
  }

  const trackSet = new Set();
  const seenTracks = new Set();
  for (const t of data.tracks) {
    if (typeof t !== 'number' || !Number.isInteger(t)) continue;
    if (seenTracks.has(t)) integrityErrors.push(`tracks contains duplicate track id: ${t}`);
    seenTracks.add(t);
    trackSet.add(t);
  }

  const clipIds = new Set();
  let maxClipId = -1;

  for (let i = 0; i < data.timelineClips.length; i++) {
    const clip = data.timelineClips[i];
    if (!clip || typeof clip !== 'object') continue;

    // mediaPath in mediaFiles
    if (typeof clip.mediaPath === 'string' && clip.mediaPath && !mediaPaths.has(clip.mediaPath)) {
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
      if (Number.isInteger(clip.id) && clip.id >= 0) maxClipId = Math.max(maxClipId, clip.id);

      // NOTE: In the renderer store, ids are generated with `newId = clipIdCounter + 1`,
      // so persisted `clipIdCounter` represents the *max used id*, not the next id.
    }

    // Trims must be consistent with originalDuration and visible duration.
    if (isFiniteNumber(clip.trimStart) && isFiniteNumber(clip.trimEnd) && isFiniteNumber(clip.originalDuration)) {
      if (clip.trimStart + clip.trimEnd > clip.originalDuration) {
        integrityErrors.push(
          `timelineClips[${i}]: trimStart (${clip.trimStart}) + trimEnd (${clip.trimEnd}) > originalDuration (${clip.originalDuration})`
        );
      }

      if (isFiniteNumber(clip.duration)) {
        const maxVisible = clip.originalDuration - clip.trimStart - clip.trimEnd;
        if (clip.duration > maxVisible) {
          integrityErrors.push(
            `timelineClips[${i}]: duration (${clip.duration}) > originalDuration - trimStart - trimEnd (${maxVisible})`
          );
        }
      }
    }

    // Keyframes should be within clip duration (warning only; durations change during editing).
    if (clip.keyframes && typeof clip.keyframes === 'object' && isFiniteNumber(clip.duration)) {
      const duration = clip.duration;
      for (const [prop, arr] of Object.entries(clip.keyframes)) {
        if (!Array.isArray(arr)) continue;
        const ids = new Set();
        let maxKfId = -1;
        for (const kf of arr) {
          if (!kf || typeof kf !== 'object') continue;
          if (typeof kf.id === 'number' && Number.isInteger(kf.id)) {
            if (ids.has(kf.id)) warnings.push(`timelineClips[${i}].keyframes.${prop}: duplicated keyframe id ${kf.id}`);
            ids.add(kf.id);
            if (kf.id > maxKfId) maxKfId = kf.id;
          }
          if (isFiniteNumber(kf.time) && kf.time > duration) {
            warnings.push(`timelineClips[${i}].keyframes.${prop}: keyframe time ${kf.time} > clip duration ${duration}`);
          }
        }
        if (typeof clip.keyframeIdCounter === 'number' && Number.isInteger(clip.keyframeIdCounter) && maxKfId >= 0) {
          if (clip.keyframeIdCounter < maxKfId) {
            integrityErrors.push(
              `timelineClips[${i}].keyframeIdCounter (${clip.keyframeIdCounter}) < max keyframe id (${maxKfId})`
            );
          }
        }
      }
    }

    const media = typeof clip.mediaPath === 'string' ? mediaByPath.get(clip.mediaPath) : undefined;
    const propDefinitions = media?.propDefinitions;
    if (propDefinitions && typeof propDefinitions === 'object' && clip.componentProps && typeof clip.componentProps === 'object') {
      const knownPropKeys = new Set(Object.keys(propDefinitions));
      for (const [propName, propValue] of Object.entries(clip.componentProps)) {
        // Allow child props objects (e.g. "overlay:props") for media-type props
        if (propName.endsWith(':props') && typeof propValue === 'object' && propValue !== null) continue;
        const def = propDefinitions[propName];
        if (!def) {
          warnings.push(`timelineClips[${i}].componentProps.${propName} is not defined in mediaFiles propDefinitions`);
          continue;
        }
        if (!matchesPropType(propValue, def.type)) {
          integrityErrors.push(
            `timelineClips[${i}].componentProps.${propName} has value type "${typeof propValue}" but expected "${def.type}"`
          );
          continue;
        }
        if (def.type === 'enum' && !def.options.includes(propValue)) {
          integrityErrors.push(
            `timelineClips[${i}].componentProps.${propName} must be one of [${def.options.join(', ')}]`
          );
        }
        if ((def.type === 'media' || def.type === 'component') && propValue !== '' && !mediaPaths.has(propValue)) {
          warnings.push(
            `timelineClips[${i}].componentProps.${propName} references missing media path "${propValue}"`
          );
        }
      }
      for (const key of knownPropKeys) {
        if (!(key in clip.componentProps)) {
          warnings.push(`timelineClips[${i}].componentProps is missing "${key}" defined in mediaFiles propDefinitions`);
        }
      }
    }
  }

  // clipIdCounter must be >= max clip id (accepts both "max id" and "next id" semantics).
  if (typeof data.clipIdCounter === 'number' && Number.isInteger(data.clipIdCounter) && maxClipId >= 0) {
    if (data.clipIdCounter < maxClipId) {
      integrityErrors.push(`clipIdCounter (${data.clipIdCounter}) < max timelineClips[].id (${maxClipId})`);
    }
  }

  // Warn about duplicate media file paths (project can still load, but behavior is ambiguous).
  const mfSeen = new Set();
  for (const mf of data.mediaFiles) {
    if (!mf || typeof mf !== 'object' || typeof mf.path !== 'string') continue;
    if (mfSeen.has(mf.path)) warnings.push(`mediaFiles contains duplicate path: ${mf.path}`);
    mfSeen.add(mf.path);
    if (mf.type === 'component' && !mf.bundlePath) warnings.push(`component media missing bundlePath: ${mf.path}`);
    if (mf.propDefinitions && typeof mf.propDefinitions === 'object') {
      for (const [propName, def] of Object.entries(mf.propDefinitions)) {
        if (!def || typeof def !== 'object') continue;

        if (typeof def.min === 'number' && typeof def.max === 'number' && def.min > def.max) {
          integrityErrors.push(`mediaFiles "${mf.path}" propDefinitions.${propName}: min (${def.min}) > max (${def.max})`);
        }
        if (typeof def.step === 'number' && def.step <= 0) {
          integrityErrors.push(`mediaFiles "${mf.path}" propDefinitions.${propName}: step must be > 0`);
        }

        if (!matchesPropType(def.default, def.type)) {
          integrityErrors.push(
            `mediaFiles "${mf.path}" propDefinitions.${propName}: default has type "${typeof def.default}" but expected "${def.type}"`
          );
          continue;
        }

        if (def.type === 'enum') {
          if (!Array.isArray(def.options) || def.options.length === 0) {
            integrityErrors.push(
              `mediaFiles "${mf.path}" propDefinitions.${propName}: options must be a non-empty string array`
            );
            continue;
          }
          const seen = new Set();
          for (const option of def.options) {
            if (typeof option !== 'string' || option.length === 0) {
              integrityErrors.push(
                `mediaFiles "${mf.path}" propDefinitions.${propName}: options must contain only non-empty strings`
              );
              continue;
            }
            if (seen.has(option)) {
              integrityErrors.push(
                `mediaFiles "${mf.path}" propDefinitions.${propName}: options contains duplicate value "${option}"`
              );
            }
            seen.add(option);
          }
          if (!def.options.includes(def.default)) {
            integrityErrors.push(
              `mediaFiles "${mf.path}" propDefinitions.${propName}: default "${def.default}" must exist in options`
            );
          }
        }

        if ((def.type === 'media' || def.type === 'component') && def.default !== '' && !mediaPaths.has(def.default)) {
          warnings.push(
            `mediaFiles "${mf.path}" propDefinitions.${propName}: default media path "${def.default}" is missing`
          );
        }

        if (def.type === 'number' && typeof def.default === 'number') {
          if (typeof def.min === 'number' && def.default < def.min) {
            integrityErrors.push(
              `mediaFiles "${mf.path}" propDefinitions.${propName}: default (${def.default}) < min (${def.min})`
            );
          }
          if (typeof def.max === 'number' && def.default > def.max) {
            integrityErrors.push(
              `mediaFiles "${mf.path}" propDefinitions.${propName}: default (${def.default}) > max (${def.max})`
            );
          }
        }
      }
    }
  }

  // Overlap detection per track
  const clipsByTrack = new Map();
  for (let i = 0; i < data.timelineClips.length; i++) {
    const clip = data.timelineClips[i];
    if (!clip || typeof clip !== 'object') continue;
    if (typeof clip.track !== 'number' || !Number.isInteger(clip.track)) continue;
    if (!isFiniteNumber(clip.startTime) || !isFiniteNumber(clip.duration)) continue;
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
