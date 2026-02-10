import type { ComponentClipProps, PropDefinition } from '../types';

type ComponentType = React.ComponentType<ComponentClipProps>;

interface CacheEntry {
  Component: ComponentType;
  propDefinitions?: Record<string, PropDefinition>;
}

const cache = new Map<string, CacheEntry>();

function codeToModuleUrl(code: string): { url: string; revoke: () => void } {
  // In the Electron renderer we expect `blob:` to be allowed by CSP.
  // In Node/test contexts, fall back to a `data:` URL because Node does not
  // support `import(blob:...)` reliably.
  try {
    if (
      typeof document !== 'undefined' &&
      typeof Blob !== 'undefined' &&
      typeof URL !== 'undefined' &&
      'createObjectURL' in URL
    ) {
      const blob = new Blob([code], { type: 'text/javascript' });
      const url = URL.createObjectURL(blob);
      return { url, revoke: () => URL.revokeObjectURL(url) };
    }
  } catch {
    // Ignore and fall back.
  }

  const url = `data:text/javascript;charset=utf-8,${encodeURIComponent(code)}`;
  return { url, revoke: () => {} };
}

export async function loadComponent(bundlePath: string): Promise<CacheEntry> {
  const cached = cache.get(bundlePath);
  if (cached) return cached;

  const buffer = await window.api.readFile(bundlePath);
  const text = new TextDecoder().decode(buffer);

  // We cannot use `eval`/`new Function` in Electron with a strict CSP. Instead,
  // treat the bundle as an ESM module and load it via dynamic `import(...)`.
  let mod: any;
  const { url, revoke } = codeToModuleUrl(text);
  try {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore - Vite needs the ignore to avoid trying to pre-bundle this.
    mod = await import(/* @vite-ignore */ url);
  } catch (err) {
    throw new Error(`Component bundle execution failed: ${err}`);
  } finally {
    revoke();
  }

  const Component = mod?.default ?? mod;
  if (typeof Component !== 'function') {
    if (/\b__editorComponent__\b/.test(text)) {
      throw new Error(
        'Legacy component bundle detected (IIFE). Please re-bundle the component (remove/re-add it) so it exports `default`.'
      );
    }
    throw new Error('Component must export default a function component');
  }

  const propDefinitions = mod?.propDefinitions as Record<string, PropDefinition> | undefined;

  const entry: CacheEntry = { Component, propDefinitions };
  cache.set(bundlePath, entry);
  return entry;
}

export function clearComponentCache(bundlePath?: string) {
  if (bundlePath) {
    cache.delete(bundlePath);
  } else {
    cache.clear();
  }
}
