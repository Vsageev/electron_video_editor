import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const require = createRequire(import.meta.url);
const { bundleComponent } = require('../../scripts/bundleComponent.js');

const fixturesDir = path.join(__dirname, 'test-fixtures');
let tmpDir;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-test-'));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function outPath(name) {
  return path.join(tmpDir, `${name}.component.js`);
}

describe('bundleComponent', () => {
  it('bundles a valid component successfully', async () => {
    const source = path.join(fixturesDir, 'ValidComponent.tsx');
    const out = outPath('ValidComponent');
    const result = await bundleComponent(source, out);

    expect(result.success).toBe(true);
    expect(result.bundlePath).toBe(out);
    expect(fs.existsSync(out)).toBe(true);

    // Check the output is an ESM module
    const content = fs.readFileSync(out, 'utf-8');
    expect(content).toMatch(/export\s+default|as\s+default/i);
  });

  it('bundles a component with local imports', async () => {
    const source = path.join(fixturesDir, 'LocalImport.tsx');
    const out = outPath('LocalImport');
    const result = await bundleComponent(source, out);

    expect(result.success).toBe(true);
    const content = fs.readFileSync(out, 'utf-8');
    expect(content).toContain('local helper works');
  });

  it('rejects banned bare-specifier imports', async () => {
    const source = path.join(fixturesDir, 'BannedImport.tsx');
    const out = outPath('BannedImport');
    const result = await bundleComponent(source, out);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/lodash.*not allowed/i);
  });

  it('rejects components with syntax errors', async () => {
    const source = path.join(fixturesDir, 'SyntaxError.tsx');
    const out = outPath('SyntaxError');
    const result = await bundleComponent(source, out);

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('bundles component without default export (esbuild does not enforce exports)', async () => {
    // esbuild bundles fine even without a default export — the check happens at runtime in componentLoader
    const source = path.join(fixturesDir, 'NoDefaultExport.tsx');
    const out = outPath('NoDefaultExport');
    const result = await bundleComponent(source, out);

    expect(result.success).toBe(true);
    const content = fs.readFileSync(out, 'utf-8');
    // No default export in source should usually mean no default export in output.
    expect(content).not.toMatch(/export\s+default/i);
  });

  it('shims react imports to window globals', async () => {
    const source = path.join(fixturesDir, 'ValidComponent.tsx');
    const out = outPath('ReactShim');
    const result = await bundleComponent(source, out);

    expect(result.success).toBe(true);
    const content = fs.readFileSync(out, 'utf-8');
    // Should reference the window shims, not bundle React
    expect(content).toContain('__EDITOR_REACT__');
  });

  it('creates output directory if it does not exist', async () => {
    const source = path.join(fixturesDir, 'ValidComponent.tsx');
    const nestedOut = path.join(tmpDir, 'nested', 'deep', 'out.component.js');
    const result = await bundleComponent(source, nestedOut);

    expect(result.success).toBe(true);
    expect(fs.existsSync(nestedOut)).toBe(true);
  });

  it('fails gracefully for nonexistent source file', async () => {
    const source = path.join(fixturesDir, 'DoesNotExist.tsx');
    const out = outPath('DoesNotExist');
    const result = await bundleComponent(source, out);

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });
});
