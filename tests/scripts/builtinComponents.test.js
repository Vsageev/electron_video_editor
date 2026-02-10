import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const require = createRequire(import.meta.url);
const { listBuiltinComponents, addBuiltinComponent } = require('../../scripts/builtinComponents.js');

let tmpDir;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'builtin-components-test-'));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function write(p, content) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf8');
}

describe('builtin components', () => {
  it('lists only .tsx/.jsx and derives names', async () => {
    const builtinDir = path.join(tmpDir, 'builtins1');
    fs.mkdirSync(builtinDir, { recursive: true });
    write(path.join(builtinDir, 'A.tsx'), 'export default function A() { return null }');
    write(path.join(builtinDir, 'B.jsx'), 'export default function B() { return null }');
    write(path.join(builtinDir, 'README.md'), '# nope');

    const entries = await listBuiltinComponents(builtinDir);
    expect(entries).toEqual(
      expect.arrayContaining([
        { name: 'A', fileName: 'A.tsx' },
        { name: 'B', fileName: 'B.jsx' },
      ])
    );
    expect(entries.find((e) => e.fileName === 'README.md')).toBeFalsy();
  });

  it('returns [] if directory does not exist', async () => {
    const entries = await listBuiltinComponents(path.join(tmpDir, 'missing-dir'));
    expect(entries).toEqual([]);
  });

  it('errors when adding missing builtin component', async () => {
    const builtinDir = path.join(tmpDir, 'builtins2');
    fs.mkdirSync(builtinDir, { recursive: true });

    const result = await addBuiltinComponent({
      builtinDir,
      projectsDir: path.join(tmpDir, 'projects2'),
      projectName: 'p1',
      fileName: 'Nope.tsx',
      bundleComponent: async () => ({ success: true }),
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not found/i);
  });

  it('copies the source into project media dir and returns relative paths', async () => {
    const builtinDir = path.join(tmpDir, 'builtins3');
    const projectsDir = path.join(tmpDir, 'projects3');
    fs.mkdirSync(builtinDir, { recursive: true });
    write(path.join(builtinDir, 'Overlay.tsx'), 'export default function Overlay() { return null }');

    const bundleComponent = async (_sourcePath, outFile) => {
      // simulate bundler output file creation
      write(outFile, 'export default function Overlay(){ return null; }');
      return { success: true };
    };

    const result = await addBuiltinComponent({
      builtinDir,
      projectsDir,
      projectName: 'p1',
      fileName: 'Overlay.tsx',
      bundleComponent,
    });

    expect(result).toEqual({
      success: true,
      sourcePath: 'media/Overlay.tsx',
      bundlePath: 'media/Overlay.component.js',
    });

    const copied = path.join(projectsDir, 'p1', 'media', 'Overlay.tsx');
    expect(fs.existsSync(copied)).toBe(true);
    const bundled = path.join(projectsDir, 'p1', 'media', 'Overlay.component.js');
    expect(fs.existsSync(bundled)).toBe(true);
  });

  it('cleans up copied source file when bundling fails', async () => {
    const builtinDir = path.join(tmpDir, 'builtins4');
    const projectsDir = path.join(tmpDir, 'projects4');
    fs.mkdirSync(builtinDir, { recursive: true });
    write(path.join(builtinDir, 'Bad.tsx'), 'export default function Bad() { return null }');

    const result = await addBuiltinComponent({
      builtinDir,
      projectsDir,
      projectName: 'p1',
      fileName: 'Bad.tsx',
      bundleComponent: async () => ({ success: false, error: 'bundle failed' }),
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('bundle failed');

    const copied = path.join(projectsDir, 'p1', 'media', 'Bad.tsx');
    expect(fs.existsSync(copied)).toBe(false);
  });
});
