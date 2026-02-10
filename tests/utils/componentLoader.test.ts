import { describe, it, expect, beforeEach, vi } from 'vitest';

// NOTE: componentLoader uses `window.api.readFile`. In tests we stub a minimal window.

function u8(text: string) {
  return new TextEncoder().encode(text);
}

describe('loadComponent', () => {
  beforeEach(() => {
    vi.resetModules();
    (globalThis as any).window = {
      api: {
        readFile: vi.fn(),
      },
    };
  });

  it('loads a component from an esbuild ESM bundle', async () => {
    const bundle = `
      export default function Comp() { return null; }
    `;
    (window as any).api.readFile.mockResolvedValue(u8(bundle));

    const { loadComponent } = await import('../../src/utils/componentLoader');
    const entry = await loadComponent('/tmp/x.component.js');
    expect(typeof entry.Component).toBe('function');
  });

  it('caches loaded components by bundlePath', async () => {
    const bundle = `export default function Comp() { return null; }`;
    (window as any).api.readFile.mockResolvedValue(u8(bundle));

    const { loadComponent, clearComponentCache } = await import('../../src/utils/componentLoader');
    clearComponentCache();

    const a = await loadComponent('/tmp/x.component.js');
    const b = await loadComponent('/tmp/x.component.js');
    expect(a).toBe(b);
    expect((window as any).api.readFile).toHaveBeenCalledTimes(1);
  });

  it('throws a clear error when bundle execution fails', async () => {
    (window as any).api.readFile.mockResolvedValue(u8('throw new Error("boom")'));
    const { loadComponent } = await import('../../src/utils/componentLoader');

    await expect(loadComponent('/tmp/bad.component.js')).rejects.toThrow(/Component bundle execution failed/i);
  });

  it('throws when the bundle does not export a function component', async () => {
    const bundle = `export default 123;`;
    (window as any).api.readFile.mockResolvedValue(u8(bundle));
    const { loadComponent } = await import('../../src/utils/componentLoader');

    await expect(loadComponent('/tmp/not-a-fn.component.js')).rejects.toThrow(/must export default a function component/i);
  });
});
