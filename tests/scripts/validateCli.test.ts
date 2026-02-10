import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { spawnSync } from 'node:child_process';

function runValidate(args: string[]) {
  // On Node >= 20.6, tsx requires --import (not --loader). Using the tsx CLI
  // sets up an IPC server which is blocked in our sandbox, so we run via node.
  return spawnSync(process.execPath, ['--import', 'tsx', 'scripts/validate.ts', ...args], {
    encoding: 'utf8',
  });
}

function write(p: string, content: string) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf8');
}

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'validate-cli-test-'));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('scripts/validate.ts (CLI)', () => {
  it('prints usage and exits non-zero when no args provided', () => {
    const r = runValidate([]);
    expect(r.status).toBe(1);
    expect((r.stderr || '') + (r.stdout || '')).toMatch(/Usage: npm run validate/i);
  });

  it('errors for missing file', () => {
    const r = runValidate([path.join(tmpDir, 'nope.json')]);
    expect(r.status).toBe(1);
    expect((r.stderr || '') + (r.stdout || '')).toMatch(/File not found/i);
  });

  it('errors for invalid JSON', () => {
    const p = path.join(tmpDir, 'bad.json');
    write(p, '{ this is not json');
    const r = runValidate([p]);
    expect(r.status).toBe(1);
    expect((r.stderr || '') + (r.stdout || '')).toMatch(/Invalid JSON/i);
  });

  it('exits 0 for a valid project', () => {
    const p = path.join(tmpDir, 'valid.json');
    write(
      p,
      JSON.stringify(
        {
          version: 1,
          name: 'cli-test',
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
          tracks: [],
          trackIdCounter: 0,
          clipIdCounter: 0,
          exportSettings: { width: 1920, height: 1080, fps: 30, bitrate: 5000000 },
          mediaFiles: [],
          timelineClips: [],
        },
        null,
        2
      )
    );

    const r = runValidate([p]);
    expect(r.status).toBe(0);
    expect((r.stdout || '') + (r.stderr || '')).toMatch(/Result: VALID/i);
  });

  it('exits non-zero for an invalid project and prints errors', () => {
    const p = path.join(tmpDir, 'invalid.json');
    // missing version and bad datetime
    write(
      p,
      JSON.stringify(
        {
          name: 'cli-test',
          createdAt: 'nope',
          updatedAt: 'nope',
          tracks: [],
          trackIdCounter: 0,
          clipIdCounter: 0,
          exportSettings: { width: 1920, height: 1080, fps: 30, bitrate: 5000000 },
          mediaFiles: [],
          timelineClips: [],
        },
        null,
        2
      )
    );

    const r = runValidate([p]);
    expect(r.status).toBe(1);
    expect((r.stdout || '') + (r.stderr || '')).toMatch(/STRUCTURE ERRORS/i);
    expect((r.stdout || '') + (r.stderr || '')).toMatch(/Result: INVALID/i);
  });
});
