import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('editorStore.openProject error handling', () => {
  beforeEach(() => {
    vi.resetModules();
    (globalThis as any).window = {
      api: {
        loadProject: vi.fn(),
        getProjectDir: vi.fn(),
        setLastProject: vi.fn(),
        watchProject: vi.fn(),
        unwatchProject: vi.fn(),
        onProjectFileChanged: vi.fn(() => () => {}),
        // used by other store actions, but not in these tests:
        createProject: vi.fn(),
        saveProject: vi.fn(),
        readMediaMetadata: vi.fn(),
        writeMediaMetadata: vi.fn(),
      },
    };
  });

  it('sets projectError when loadProject returns success=false', async () => {
    (window as any).api.loadProject.mockResolvedValue({ success: false, error: 'Invalid JSON: boom' });

    const { useEditorStore } = await import('../../src/store/editorStore');
    await useEditorStore.getState().openProject('p1');

    const s = useEditorStore.getState();
    expect(s.projectError).toBe('Invalid JSON: boom');
    expect(s.currentProject).toBe(null);
  });

  it('sets projectError when loadProject throws', async () => {
    (window as any).api.loadProject.mockRejectedValue(new Error('disk read failed'));

    const { useEditorStore } = await import('../../src/store/editorStore');
    await useEditorStore.getState().openProject('p1');

    const s = useEditorStore.getState();
    expect(s.projectError).toMatch(/disk read failed/i);
    expect(s.currentProject).toBe(null);
  });
});

