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
      selectedClipIds: [1],
      mediaMetadata: { [mediaAPath]: 'x', [mediaABundle]: 'y' },
    } as any);

    useEditorStore.getState().removeMediaFile(0);

    const s = useEditorStore.getState();
    expect(s.mediaFiles.map((m) => m.path)).toEqual([mediaBPath]);
    expect(s.timelineClips.map((c) => c.id)).toEqual([2]);
    expect(s.selectedClipIds).toEqual([]);

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

  it('clears component reference props and persists cleaned project data', async () => {
    const { useEditorStore } = await import('../../src/store/editorStore');

    const projectDir = '/tmp/projects/p1';
    const removedComponentPath = projectDir + '/media/child.tsx';
    const removedBundlePath = projectDir + '/media/child.component.js';
    const parentComponentPath = projectDir + '/media/parent.tsx';
    const createdAt = '2024-01-01T00:00:00.000Z';

    (window as any).api.loadProject.mockResolvedValue({ success: true, data: { createdAt } });

    useEditorStore.setState({
      currentProject: 'p1',
      projectDir,
      mediaFiles: [
        {
          path: removedComponentPath,
          name: 'child.tsx',
          ext: '.tsx',
          type: 'component',
          duration: 5,
          bundlePath: removedBundlePath,
        },
        {
          path: parentComponentPath,
          name: 'parent.tsx',
          ext: '.tsx',
          type: 'component',
          duration: 5,
          propDefinitions: {
            child: { type: 'media', default: '', label: 'Child' },
            title: { type: 'string', default: 'hello', label: 'Title' },
          },
        },
      ],
      timelineClips: [
        {
          id: 10,
          mediaPath: parentComponentPath,
          mediaName: 'parent.tsx',
          track: 1,
          startTime: 0,
          duration: 5,
          trimStart: 0,
          trimEnd: 0,
          originalDuration: 5,
          x: 0,
          y: 0,
          scale: 1,
          scaleX: 1,
          scaleY: 1,
          componentProps: {
            child: removedComponentPath,
            title: 'kept',
          },
        },
      ],
      tracks: [1],
      trackIdCounter: 1,
      clipIdCounter: 10,
      exportSettings: { width: 1920, height: 1080, fps: 30, bitrate: 5_000_000 },
    } as any);

    useEditorStore.getState().removeMediaFile(0);
    const s = useEditorStore.getState();
    expect(s.mediaFiles.map((m) => m.path)).toEqual([parentComponentPath]);
    expect(s.timelineClips[0]?.componentProps?.child).toBe('');
    expect(s.timelineClips[0]?.componentProps?.title).toBe('kept');

    await s.saveProject();
    expect((window as any).api.saveProject).toHaveBeenCalledWith(
      'p1',
      expect.objectContaining({
        createdAt,
        mediaFiles: [
          expect.objectContaining({
            path: 'media/parent.tsx',
          }),
        ],
        timelineClips: [
          expect.objectContaining({
            mediaPath: 'media/parent.tsx',
            componentProps: expect.objectContaining({
              child: '',
              title: 'kept',
            }),
          }),
        ],
      })
    );

    expect((window as any).api.deleteMediaFromProject).toHaveBeenCalledWith('p1', 'media/child.tsx');
    expect((window as any).api.deleteMediaFromProject).toHaveBeenCalledWith('p1', 'media/child.component.js');
  });
});
