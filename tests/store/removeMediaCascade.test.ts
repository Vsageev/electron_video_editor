import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('editorStore.removeMediaFile cascading behavior', () => {
  beforeEach(() => {
    vi.resetModules();
    (globalThis as any).window = {
      api: {
        deleteMediaFromProject: vi.fn().mockResolvedValue({ success: true }),
        // used by other store actions, but not in these tests:
        loadProject: vi.fn(),
        getProjectDir: vi.fn(),
        setLastProject: vi.fn(),
        watchProject: vi.fn(),
        unwatchProject: vi.fn(),
        onProjectFileChanged: vi.fn(() => () => {}),
        createProject: vi.fn(),
        saveProject: vi.fn(),
        readMediaMetadata: vi.fn(),
        writeMediaMetadata: vi.fn(),
      },
    };
  });

  it('removes referencing clips and deletes media files from the project media folder', async () => {
    const { useEditorStore } = await import('../../src/store/editorStore');

    const projectDir = '/tmp/projects/p1';
    const mediaAPath = projectDir + '/media/a.mp4';
    const mediaABundle = projectDir + '/media/a.component.js';
    const mediaBPath = projectDir + '/media/b.mp4';

    useEditorStore.setState({
      currentProject: 'p1',
      projectDir,
      mediaFiles: [
        { path: mediaAPath, name: 'a.mp4', ext: '.mp4', type: 'video', duration: 1, bundlePath: mediaABundle },
        { path: mediaBPath, name: 'b.mp4', ext: '.mp4', type: 'video', duration: 1 },
      ],
      selectedMediaIndex: 1,
      previewMediaPath: mediaAPath,
      previewMediaType: 'video',
      timelineClips: [
        { id: 1, mediaPath: mediaAPath, mediaName: 'a.mp4', track: 1, startTime: 0, duration: 1, trimStart: 0, trimEnd: 0, originalDuration: 1, x: 0, y: 0, scale: 1, scaleX: 1, scaleY: 1 },
        { id: 2, mediaPath: mediaBPath, mediaName: 'b.mp4', track: 1, startTime: 1, duration: 1, trimStart: 0, trimEnd: 0, originalDuration: 1, x: 0, y: 0, scale: 1, scaleX: 1, scaleY: 1 },
      ],
      selectedClipId: 1,
      mediaMetadata: { [mediaAPath]: 'x', [mediaABundle]: 'y' },
    } as any);

    useEditorStore.getState().removeMediaFile(0);

    const s = useEditorStore.getState();
    expect(s.mediaFiles.map((m) => m.path)).toEqual([mediaBPath]);
    expect(s.timelineClips.map((c) => c.id)).toEqual([2]);
    expect(s.selectedClipId).toBe(null);

    // selected index shifts left after removal
    expect(s.selectedMediaIndex).toBe(0);

    // preview clears if it was showing removed media
    expect(s.previewMediaPath).toBe(null);
    expect(s.previewMediaType).toBe(null);

    // cached metadata cleared
    expect(s.mediaMetadata[mediaAPath]).toBeUndefined();
    expect(s.mediaMetadata[mediaABundle]).toBeUndefined();

    expect((window as any).api.deleteMediaFromProject).toHaveBeenCalledWith('p1', 'media/a.mp4');
    expect((window as any).api.deleteMediaFromProject).toHaveBeenCalledWith('p1', 'media/a.component.js');
  });

  it('does not try to delete files outside the project directory', async () => {
    const { useEditorStore } = await import('../../src/store/editorStore');

    useEditorStore.setState({
      currentProject: 'p1',
      projectDir: '/tmp/projects/p1',
      mediaFiles: [
        { path: '/tmp/external/x.mp4', name: 'x.mp4', ext: '.mp4', type: 'video', duration: 1 },
      ],
    } as any);

    useEditorStore.getState().removeMediaFile(0);

    expect((window as any).api.deleteMediaFromProject).not.toHaveBeenCalled();
  });
});

