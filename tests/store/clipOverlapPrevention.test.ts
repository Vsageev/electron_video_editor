import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('editorStore clip overlap prevention', () => {
  beforeEach(() => {
    vi.resetModules();
    (globalThis as any).window = {
      api: {
        deleteMediaFromProject: vi.fn().mockResolvedValue({ success: true }),
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

  it('rejects startTime update when it would overlap a clip on the same track', async () => {
    const { useEditorStore } = await import('../../src/store/editorStore');
    useEditorStore.setState({
      timelineClips: [
        {
          id: 1, mediaPath: 'a', mediaName: 'a', track: 1, startTime: 0, duration: 5,
          trimStart: 0, trimEnd: 0, originalDuration: 5, x: 0, y: 0, scale: 1, scaleX: 1, scaleY: 1,
        },
        {
          id: 2, mediaPath: 'b', mediaName: 'b', track: 1, startTime: 6, duration: 3,
          trimStart: 0, trimEnd: 0, originalDuration: 3, x: 0, y: 0, scale: 1, scaleX: 1, scaleY: 1,
        },
      ],
    } as any);

    useEditorStore.getState().updateClip(2, { startTime: 4 });
    const clip2 = useEditorStore.getState().timelineClips.find((c) => c.id === 2);
    expect(clip2?.startTime).toBe(6);
  });

  it('rejects duration update when it would overlap a clip on the same track', async () => {
    const { useEditorStore } = await import('../../src/store/editorStore');
    useEditorStore.setState({
      timelineClips: [
        {
          id: 1, mediaPath: 'a', mediaName: 'a', track: 1, startTime: 0, duration: 5,
          trimStart: 0, trimEnd: 0, originalDuration: 5, x: 0, y: 0, scale: 1, scaleX: 1, scaleY: 1,
        },
        {
          id: 2, mediaPath: 'b', mediaName: 'b', track: 1, startTime: 5, duration: 2,
          trimStart: 0, trimEnd: 0, originalDuration: 2, x: 0, y: 0, scale: 1, scaleX: 1, scaleY: 1,
        },
      ],
    } as any);

    useEditorStore.getState().updateClip(1, { duration: 6 });
    const clip1 = useEditorStore.getState().timelineClips.find((c) => c.id === 1);
    expect(clip1?.duration).toBe(5);
  });

  it('rejects track update when destination track has overlap', async () => {
    const { useEditorStore } = await import('../../src/store/editorStore');
    useEditorStore.setState({
      timelineClips: [
        {
          id: 1, mediaPath: 'a', mediaName: 'a', track: 1, startTime: 1, duration: 3,
          trimStart: 0, trimEnd: 0, originalDuration: 3, x: 0, y: 0, scale: 1, scaleX: 1, scaleY: 1,
        },
        {
          id: 2, mediaPath: 'b', mediaName: 'b', track: 2, startTime: 0, duration: 4,
          trimStart: 0, trimEnd: 0, originalDuration: 4, x: 0, y: 0, scale: 1, scaleX: 1, scaleY: 1,
        },
      ],
    } as any);

    useEditorStore.getState().updateClip(1, { track: 2 });
    const clip1 = useEditorStore.getState().timelineClips.find((c) => c.id === 1);
    expect(clip1?.track).toBe(1);
  });

  it('allows non-overlapping placement updates', async () => {
    const { useEditorStore } = await import('../../src/store/editorStore');
    useEditorStore.setState({
      timelineClips: [
        {
          id: 1, mediaPath: 'a', mediaName: 'a', track: 1, startTime: 0, duration: 4,
          trimStart: 0, trimEnd: 0, originalDuration: 4, x: 0, y: 0, scale: 1, scaleX: 1, scaleY: 1,
        },
        {
          id: 2, mediaPath: 'b', mediaName: 'b', track: 2, startTime: 0, duration: 4,
          trimStart: 0, trimEnd: 0, originalDuration: 4, x: 0, y: 0, scale: 1, scaleX: 1, scaleY: 1,
        },
      ],
    } as any);

    useEditorStore.getState().updateClip(2, { track: 1, startTime: 4 });
    const clip2 = useEditorStore.getState().timelineClips.find((c) => c.id === 2);
    expect(clip2?.track).toBe(1);
    expect(clip2?.startTime).toBe(4);
  });
});
