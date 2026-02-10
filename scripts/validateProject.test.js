import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const require = createRequire(import.meta.url);
const { validateProject } = require('./validateProject.js');

// --- Helpers ---

function makeValidProject(overrides = {}) {
  return {
    version: 1,
    name: 'test-project',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    tracks: [0, 1],
    trackIdCounter: 2,
    clipIdCounter: 2,
    exportSettings: { width: 1920, height: 1080, fps: 30, bitrate: 5000000 },
    mediaFiles: [
      { path: 'media/video.mp4', name: 'video.mp4', ext: '.mp4', type: 'video', duration: 10 },
    ],
    timelineClips: [
      {
        id: 0, mediaPath: 'media/video.mp4', mediaName: 'video.mp4', type: 'video',
        track: 0, startTime: 0, duration: 5, trimStart: 0, trimEnd: 0,
        originalDuration: 10, x: 0, y: 0, scale: 1, scaleX: 1, scaleY: 1,
      },
      {
        id: 1, mediaPath: 'media/video.mp4', mediaName: 'video.mp4', type: 'video',
        track: 1, startTime: 0, duration: 5, trimStart: 0, trimEnd: 0,
        originalDuration: 10, x: 0, y: 0, scale: 1, scaleX: 1, scaleY: 1,
      },
    ],
    ...overrides,
  };
}

// --- Tests ---

describe('validateProject', () => {
  describe('valid projects', () => {
    it('accepts a minimal valid project', () => {
      const data = makeValidProject({ timelineClips: [], mediaFiles: [] });
      const result = validateProject(data);
      expect(result.structureErrors).toEqual([]);
      expect(result.integrityErrors).toEqual([]);
    });

    it('accepts a full valid project with clips', () => {
      const result = validateProject(makeValidProject());
      expect(result.structureErrors).toEqual([]);
      expect(result.integrityErrors).toEqual([]);
    });

    it('accepts clips with keyframes', () => {
      const data = makeValidProject();
      data.timelineClips[0].keyframes = {
        x: [{ id: 0, time: 0, value: 0, easing: 'linear' }, { id: 1, time: 1, value: 100, easing: 'ease-in' }],
      };
      data.timelineClips[0].keyframeIdCounter = 2;
      const result = validateProject(data);
      expect(result.structureErrors).toEqual([]);
      expect(result.integrityErrors).toEqual([]);
    });

    it('accepts clips with mask', () => {
      const data = makeValidProject();
      data.timelineClips[0].mask = {
        shape: 'ellipse', centerX: 0.5, centerY: 0.5, width: 0.8, height: 0.8,
        rotation: 0, feather: 5, borderRadius: 0, invert: false,
      };
      const result = validateProject(data);
      expect(result.structureErrors).toEqual([]);
    });
  });

  describe('structure errors (Zod)', () => {
    it('rejects missing version', () => {
      const data = makeValidProject();
      delete data.version;
      const result = validateProject(data);
      expect(result.structureErrors.length).toBeGreaterThan(0);
      expect(result.structureErrors[0]).toMatch(/version/i);
    });

    it('rejects non-string name', () => {
      const data = makeValidProject({ name: 123 });
      const result = validateProject(data);
      expect(result.structureErrors.length).toBeGreaterThan(0);
    });

    it('rejects empty name', () => {
      const data = makeValidProject({ name: '' });
      const result = validateProject(data);
      expect(result.structureErrors.length).toBeGreaterThan(0);
    });

    it('rejects invalid datetime', () => {
      const data = makeValidProject({ createdAt: 'not-a-date' });
      const result = validateProject(data);
      expect(result.structureErrors.length).toBeGreaterThan(0);
    });

    it('rejects non-array tracks', () => {
      const data = makeValidProject({ tracks: 'nope' });
      const result = validateProject(data);
      expect(result.structureErrors.length).toBeGreaterThan(0);
    });

    it('rejects negative export width', () => {
      const data = makeValidProject({ exportSettings: { width: -1, height: 1080, fps: 30, bitrate: 5000000 } });
      const result = validateProject(data);
      expect(result.structureErrors.length).toBeGreaterThan(0);
    });

    it('rejects clip with negative duration', () => {
      const data = makeValidProject();
      data.timelineClips[0].duration = -1;
      const result = validateProject(data);
      expect(result.structureErrors.length).toBeGreaterThan(0);
    });

    it('rejects clip with empty mediaPath', () => {
      const data = makeValidProject();
      data.timelineClips[0].mediaPath = '';
      const result = validateProject(data);
      expect(result.structureErrors.length).toBeGreaterThan(0);
    });

    it('rejects invalid media type', () => {
      const data = makeValidProject();
      data.mediaFiles[0].type = 'image';
      const result = validateProject(data);
      expect(result.structureErrors.length).toBeGreaterThan(0);
    });

    it('rejects invalid keyframe easing', () => {
      const data = makeValidProject();
      data.timelineClips[0].keyframes = {
        x: [{ id: 0, time: 0, value: 0, easing: 'bounce' }],
      };
      const result = validateProject(data);
      expect(result.structureErrors.length).toBeGreaterThan(0);
    });

    it('rejects completely garbage input', () => {
      const result = validateProject('not an object');
      expect(result.structureErrors.length).toBeGreaterThan(0);
    });

    it('rejects null input', () => {
      const result = validateProject(null);
      expect(result.structureErrors.length).toBeGreaterThan(0);
    });
  });

  describe('integrity errors', () => {
    it('detects mediaPath not in mediaFiles', () => {
      const data = makeValidProject();
      data.timelineClips[0].mediaPath = 'media/nonexistent.mp4';
      const result = validateProject(data);
      expect(result.integrityErrors).toEqual(
        expect.arrayContaining([expect.stringMatching(/mediaPath.*not found in mediaFiles/)])
      );
    });

    it('detects track not in tracks array', () => {
      const data = makeValidProject();
      data.timelineClips[0].track = 99;
      const result = validateProject(data);
      expect(result.integrityErrors).toEqual(
        expect.arrayContaining([expect.stringMatching(/track 99 not found in tracks/)])
      );
    });

    it('detects duplicate clip IDs', () => {
      const data = makeValidProject();
      data.timelineClips[1].id = 0; // same as clip 0
      const result = validateProject(data);
      expect(result.integrityErrors).toEqual(
        expect.arrayContaining([expect.stringMatching(/id 0 is duplicated/)])
      );
    });

    it('detects clip ID >= clipIdCounter', () => {
      const data = makeValidProject({ clipIdCounter: 1 }); // clip id=1 >= counter=1
      const result = validateProject(data);
      expect(result.integrityErrors).toEqual(
        expect.arrayContaining([expect.stringMatching(/id 1 >= clipIdCounter/)])
      );
    });

    it('detects trimStart + trimEnd > originalDuration', () => {
      const data = makeValidProject();
      data.timelineClips[0].trimStart = 6;
      data.timelineClips[0].trimEnd = 6;
      // originalDuration = 10, 6+6=12 > 10
      const result = validateProject(data);
      expect(result.integrityErrors).toEqual(
        expect.arrayContaining([expect.stringMatching(/trimStart.*trimEnd.*originalDuration/)])
      );
    });

    it('detects overlapping clips on same track', () => {
      const data = makeValidProject();
      // Put both clips on same track, overlapping
      data.timelineClips[0].track = 0;
      data.timelineClips[0].startTime = 0;
      data.timelineClips[0].duration = 5;
      data.timelineClips[1].track = 0;
      data.timelineClips[1].startTime = 3; // overlaps with [0,5)
      data.timelineClips[1].duration = 5;
      const result = validateProject(data);
      expect(result.integrityErrors).toEqual(
        expect.arrayContaining([expect.stringMatching(/overlap/)])
      );
    });

    it('allows non-overlapping clips on same track', () => {
      const data = makeValidProject();
      data.timelineClips[0].track = 0;
      data.timelineClips[0].startTime = 0;
      data.timelineClips[0].duration = 3;
      data.timelineClips[1].track = 0;
      data.timelineClips[1].startTime = 3; // starts exactly where 0 ends
      data.timelineClips[1].duration = 3;
      const result = validateProject(data);
      expect(result.integrityErrors.filter(e => e.includes('overlap'))).toEqual([]);
    });
  });

  describe('disk warnings', () => {
    it('warns about missing media files when projectDir provided', () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'validate-test-'));
      const data = makeValidProject();
      // media/video.mp4 does not exist in tmpDir
      const result = validateProject(data, tmpDir);
      expect(result.warnings).toEqual(
        expect.arrayContaining([expect.stringMatching(/Media file missing on disk/)])
      );
      fs.rmSync(tmpDir, { recursive: true });
    });

    it('no warnings when media file exists on disk', () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'validate-test-'));
      const mediaDir = path.join(tmpDir, 'media');
      fs.mkdirSync(mediaDir);
      fs.writeFileSync(path.join(mediaDir, 'video.mp4'), '');
      const data = makeValidProject();
      const result = validateProject(data, tmpDir);
      expect(result.warnings).toEqual([]);
      fs.rmSync(tmpDir, { recursive: true });
    });

    it('skips disk checks when projectDir is omitted', () => {
      const data = makeValidProject();
      const result = validateProject(data);
      expect(result.warnings).toEqual([]);
    });
  });

  describe('combined errors', () => {
    it('reports both structure and integrity errors', () => {
      const data = makeValidProject();
      data.version = 'bad'; // structure error
      data.timelineClips[0].mediaPath = 'media/gone.mp4'; // integrity error
      const result = validateProject(data);
      expect(result.structureErrors.length).toBeGreaterThan(0);
      expect(result.integrityErrors.length).toBeGreaterThan(0);
    });
  });
});
