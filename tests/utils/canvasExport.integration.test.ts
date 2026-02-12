import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MediaFile, TimelineClip } from '../../src/types';

const loadComponentMock = vi.fn();
const toCanvasMock = vi.fn();
const rootRenderMock = vi.fn();
const rootUnmountMock = vi.fn();
const createRootMock = vi.fn(() => ({
  render: rootRenderMock,
  unmount: rootUnmountMock,
}));

vi.mock('../../src/utils/componentLoader', () => ({
  loadComponent: loadComponentMock,
}));

vi.mock('html-to-image', () => ({
  toCanvas: toCanvasMock,
}));

vi.mock('react-dom/client', () => ({
  createRoot: createRootMock,
}));

vi.mock('react-dom', () => ({
  flushSync: (fn: () => void) => fn(),
}));

vi.mock('webm-muxer', () => {
  class ArrayBufferTarget {
    buffer = new ArrayBuffer(64);
  }
  class Muxer {
    addVideoChunk = vi.fn();
    addAudioChunk = vi.fn();
    finalize = vi.fn();
    constructor(_: any) {}
  }
  return { ArrayBufferTarget, Muxer };
});

function makeCanvasContext() {
  return {
    fillStyle: '#000',
    filter: 'none',
    fillRect: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    beginPath: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    ellipse: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    arcTo: vi.fn(),
    closePath: vi.fn(),
    drawImage: vi.fn(),
  };
}

function makeClip(overrides?: Partial<TimelineClip>): TimelineClip {
  return {
    id: 1,
    mediaPath: '/media/comp.tsx',
    mediaName: 'comp.tsx',
    track: 1,
    startTime: 0,
    duration: 1,
    trimStart: 0,
    trimEnd: 0,
    originalDuration: 1,
    x: 0,
    y: 0,
    scale: 1,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    ...overrides,
  };
}

function makeComponentMedia(overrides?: Partial<MediaFile>): MediaFile {
  return {
    path: '/media/comp.tsx',
    name: 'comp.tsx',
    ext: '.tsx',
    type: 'component',
    duration: 0,
    bundlePath: '/bundles/comp.js',
    ...overrides,
  };
}

let offscreenDiv: any;
let ctx: ReturnType<typeof makeCanvasContext>;

describe('exportToVideo component rendering', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    ctx = makeCanvasContext();
    const mainCanvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => ctx),
    };
    offscreenDiv = {
      style: {} as Record<string, string>,
      remove: vi.fn(),
    };

    (globalThis as any).__testCanvasCtx = ctx;

    (globalThis as any).document = {
      createElement: vi.fn((tag: string) => {
        if (tag === 'canvas') return mainCanvas;
        if (tag === 'div') return offscreenDiv;
        if (tag === 'video') return {};
        if (tag === 'img') return {};
        return {};
      }),
      body: {
        appendChild: vi.fn(),
      },
    };

    class MockVideoFrame {
      constructor(_: any, __: any) {}
      close() {}
    }
    class MockVideoEncoder {
      private output: (chunk: any, meta?: any) => void;
      constructor(opts: { output: (chunk: any, meta?: any) => void }) {
        this.output = opts.output;
      }
      configure() {}
      encode(_: any, __?: any) {
        this.output({ byteLength: 1 }, {});
      }
      async flush() {}
      close() {}
    }

    (globalThis as any).VideoFrame = MockVideoFrame;
    (globalThis as any).VideoEncoder = MockVideoEncoder;
    (globalThis as any).window = {
      api: {
        readFile: vi.fn(),
      },
    };

    toCanvasMock.mockResolvedValue({});
  });

  // ---------------------------------------------------------------------------
  // Basic component rendering
  // ---------------------------------------------------------------------------

  it('renders component clips through offscreen React tree and draws them to export canvas', async () => {
    const Parent = vi.fn(() => null);
    const media = makeComponentMedia({
      propDefinitions: { title: { type: 'string', default: 'x', label: 'Title' } },
    });
    loadComponentMock.mockResolvedValueOnce({
      Component: Parent,
      propDefinitions: media.propDefinitions,
    });

    const clip = makeClip({ componentProps: { title: 'Hello export' } });

    const { exportToVideo } = await import('../../src/utils/canvasExport');
    await exportToVideo(
      [clip], 1920, 1080, 1, () => {}, new AbortController().signal, 8_000_000,
      [media], [1],
    );

    expect(createRootMock).toHaveBeenCalledTimes(1);
    expect(rootRenderMock).toHaveBeenCalled();
    expect(toCanvasMock).toHaveBeenCalled();
    expect(ctx.drawImage).toHaveBeenCalled();

    const rendered = rootRenderMock.mock.calls[0][0];
    const componentElem = rendered.props.children;
    expect(componentElem.type).toBe(Parent);
    expect(componentElem.props.title).toBe('Hello export');
  });

  // ---------------------------------------------------------------------------
  // drawImage is called with the rasterized canvas and correct coordinates
  // ---------------------------------------------------------------------------

  it('drawImage receives the toCanvas result at correct position and size', async () => {
    const Comp = vi.fn(() => null);
    const rasterResult = { __raster: true }; // unique sentinel so we can identify it
    toCanvasMock.mockResolvedValue(rasterResult);

    const media = makeComponentMedia();
    loadComponentMock.mockResolvedValueOnce({ Component: Comp });

    const clip = makeClip();
    const { exportToVideo } = await import('../../src/utils/canvasExport');
    await exportToVideo(
      [clip], 1920, 1080, 1, () => {}, new AbortController().signal, 8_000_000,
      [media], [1],
    );

    // drawImage should be called with: (rasterCanvas, drawX, drawY, scaledW, scaledH)
    // For default transform: drawX=0, drawY=0, scaledW=1920, scaledH=1080
    expect(ctx.drawImage).toHaveBeenCalledTimes(1);
    const [source, dx, dy, dw, dh] = ctx.drawImage.mock.calls[0];
    expect(source).toBe(rasterResult);
    expect(dx).toBe(0);
    expect(dy).toBe(0);
    expect(dw).toBe(1920);
    expect(dh).toBe(1080);
  });

  // ---------------------------------------------------------------------------
  // toCanvas receives offscreenDiv with correct options
  // ---------------------------------------------------------------------------

  it('toCanvas receives the offscreen div and correct dimensions', async () => {
    const Comp = vi.fn(() => null);
    const media = makeComponentMedia();
    loadComponentMock.mockResolvedValueOnce({ Component: Comp });

    const clip = makeClip();
    const { exportToVideo } = await import('../../src/utils/canvasExport');
    await exportToVideo(
      [clip], 1280, 720, 1, () => {}, new AbortController().signal, 8_000_000,
      [media], [1],
    );

    expect(toCanvasMock).toHaveBeenCalledTimes(1);
    const [node, options] = toCanvasMock.mock.calls[0];
    expect(node).toBe(offscreenDiv);
    expect(options.width).toBe(1280);
    expect(options.height).toBe(720);
    expect(options.canvasWidth).toBe(1280);
    expect(options.canvasHeight).toBe(720);
  });

  // ---------------------------------------------------------------------------
  // Wrapper div dimensions match scaledW x scaledH
  // ---------------------------------------------------------------------------

  it('wrapper div in offscreen render has correct dimensions', async () => {
    const Comp = vi.fn(() => null);
    const media = makeComponentMedia();
    loadComponentMock.mockResolvedValueOnce({ Component: Comp });

    const clip = makeClip();
    const { exportToVideo } = await import('../../src/utils/canvasExport');
    await exportToVideo(
      [clip], 1920, 1080, 1, () => {}, new AbortController().signal, 8_000_000,
      [media], [1],
    );

    const rendered = rootRenderMock.mock.calls[0][0];
    // Wrapper div should have width and height matching scaledW/scaledH
    expect(rendered.props.style.width).toBe(1920);
    expect(rendered.props.style.height).toBe(1080);
  });

  // ---------------------------------------------------------------------------
  // Component receives standard ComponentClipProps
  // ---------------------------------------------------------------------------

  it('component receives currentTime, duration, width, height, progress', async () => {
    const Comp = vi.fn(() => null);
    const media = makeComponentMedia();
    loadComponentMock.mockResolvedValueOnce({ Component: Comp });

    const clip = makeClip({ startTime: 0, duration: 2 });
    const { exportToVideo } = await import('../../src/utils/canvasExport');
    await exportToVideo(
      [clip], 1920, 1080, 1, () => {}, new AbortController().signal, 8_000_000,
      [media], [1],
    );

    // Frame 0 at t=0: currentTime=0, progress=0
    const rendered = rootRenderMock.mock.calls[0][0];
    const compProps = rendered.props.children.props;
    expect(compProps.currentTime).toBe(0);
    expect(compProps.duration).toBe(2);
    expect(compProps.width).toBe(1920);
    expect(compProps.height).toBe(1080);
    expect(compProps.progress).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // Component renders on EVERY frame it's visible
  // ---------------------------------------------------------------------------

  it('renders component on every visible frame', async () => {
    const Comp = vi.fn(() => null);
    const media = makeComponentMedia();
    loadComponentMock.mockResolvedValueOnce({ Component: Comp });

    // 1 second clip at 3fps = 3 frames
    const clip = makeClip({ duration: 1 });
    const { exportToVideo } = await import('../../src/utils/canvasExport');
    await exportToVideo(
      [clip], 640, 480, 3, () => {}, new AbortController().signal, 8_000_000,
      [media], [1],
    );

    // rootRender should be called once per frame
    expect(rootRenderMock).toHaveBeenCalledTimes(3);
    // toCanvas should be called once per frame
    expect(toCanvasMock).toHaveBeenCalledTimes(3);
    // drawImage should be called once per frame
    expect(ctx.drawImage).toHaveBeenCalledTimes(3);

    // Verify currentTime advances across frames
    const times = rootRenderMock.mock.calls.map(
      (call: any) => call[0].props.children.props.currentTime,
    );
    expect(times[0]).toBeCloseTo(0);
    expect(times[1]).toBeCloseTo(1 / 3);
    expect(times[2]).toBeCloseTo(2 / 3);
  });

  // ---------------------------------------------------------------------------
  // Component NOT visible at some frames is NOT rendered
  // ---------------------------------------------------------------------------

  it('does not render component on frames where clip is not visible', async () => {
    const Comp = vi.fn(() => null);
    const media = makeComponentMedia();
    loadComponentMock.mockResolvedValueOnce({ Component: Comp });

    // Clip starts at t=1, but timeline is 2 seconds. At 1fps, frames at t=0 and t=1.
    // Frame 0 (t=0): clip NOT visible (starts at 1)
    // Frame 1 (t=1): clip IS visible (1 >= 1 && 1 < 2)
    const clip = makeClip({ startTime: 1, duration: 1 });
    const { exportToVideo } = await import('../../src/utils/canvasExport');
    await exportToVideo(
      [clip], 640, 480, 1, () => {}, new AbortController().signal, 8_000_000,
      [media], [1],
    );

    // Component should only render on frame 1
    expect(rootRenderMock).toHaveBeenCalledTimes(1);
    expect(ctx.drawImage).toHaveBeenCalledTimes(1);
  });

  // ---------------------------------------------------------------------------
  // Component with NO componentProps
  // ---------------------------------------------------------------------------

  it('renders component with undefined componentProps', async () => {
    const Comp = vi.fn(() => null);
    const media = makeComponentMedia();
    loadComponentMock.mockResolvedValueOnce({ Component: Comp });

    const clip = makeClip({ componentProps: undefined });
    const { exportToVideo } = await import('../../src/utils/canvasExport');
    await exportToVideo(
      [clip], 1920, 1080, 1, () => {}, new AbortController().signal, 8_000_000,
      [media], [1],
    );

    expect(rootRenderMock).toHaveBeenCalledTimes(1);
    expect(ctx.drawImage).toHaveBeenCalledTimes(1);

    const compProps = rootRenderMock.mock.calls[0][0].props.children.props;
    expect(compProps.currentTime).toBe(0);
    expect(compProps.duration).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // Component with propDefinitions undefined from loadComponent
  // ---------------------------------------------------------------------------

  it('renders component when loadComponent returns no propDefinitions', async () => {
    const Comp = vi.fn(() => null);
    const media = makeComponentMedia();
    // loadComponent returns Component but NO propDefinitions
    loadComponentMock.mockResolvedValueOnce({ Component: Comp });

    const clip = makeClip({ componentProps: { title: 'Test' } });
    const { exportToVideo } = await import('../../src/utils/canvasExport');
    await exportToVideo(
      [clip], 1920, 1080, 1, () => {}, new AbortController().signal, 8_000_000,
      [media], [1],
    );

    expect(rootRenderMock).toHaveBeenCalledTimes(1);
    expect(ctx.drawImage).toHaveBeenCalledTimes(1);

    // componentProps should pass through as-is when propDefinitions is undefined
    const compProps = rootRenderMock.mock.calls[0][0].props.children.props;
    expect(compProps.title).toBe('Test');
  });

  // ---------------------------------------------------------------------------
  // Component with loadComponent failure — silently skipped
  // ---------------------------------------------------------------------------

  it('silently skips component when loadComponent fails', async () => {
    const media = makeComponentMedia();
    loadComponentMock.mockRejectedValueOnce(new Error('Bundle not found'));

    const clip = makeClip();
    const { exportToVideo } = await import('../../src/utils/canvasExport');
    // Should not throw
    await exportToVideo(
      [clip], 1920, 1080, 1, () => {}, new AbortController().signal, 8_000_000,
      [media], [1],
    );

    // No component rendering should happen
    expect(rootRenderMock).not.toHaveBeenCalled();
    expect(toCanvasMock).not.toHaveBeenCalled();
    // drawImage should NOT be called (no content to draw)
    expect(ctx.drawImage).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Component with transform (offset, scale)
  // ---------------------------------------------------------------------------

  it('draws component at correct position with non-zero offset', async () => {
    const Comp = vi.fn(() => null);
    const rasterResult = { __raster: true };
    toCanvasMock.mockResolvedValue(rasterResult);
    const media = makeComponentMedia();
    loadComponentMock.mockResolvedValueOnce({ Component: Comp });

    const clip = makeClip({ x: 0.25, y: -0.1 });
    const { exportToVideo } = await import('../../src/utils/canvasExport');
    await exportToVideo(
      [clip], 1920, 1080, 1, () => {}, new AbortController().signal, 8_000_000,
      [media], [1],
    );

    // For component clips: drawX = (width - scaledW)/2 + x * width
    // scaledW = 1920 * 1 * 1 = 1920, so drawX = 0 + 0.25 * 1920 = 480
    // drawY = 0 + (-0.1) * 1080 = -108
    const [, dx, dy, dw, dh] = ctx.drawImage.mock.calls[0];
    expect(dx).toBeCloseTo(480);
    expect(dy).toBeCloseTo(-108);
    expect(dw).toBe(1920);
    expect(dh).toBe(1080);
  });

  it('draws component with non-default scale', async () => {
    const Comp = vi.fn(() => null);
    const rasterResult = { __raster: true };
    toCanvasMock.mockResolvedValue(rasterResult);
    const media = makeComponentMedia();
    loadComponentMock.mockResolvedValueOnce({ Component: Comp });

    const clip = makeClip({ scale: 0.5 });
    const { exportToVideo } = await import('../../src/utils/canvasExport');
    await exportToVideo(
      [clip], 1920, 1080, 1, () => {}, new AbortController().signal, 8_000_000,
      [media], [1],
    );

    // scaledW = 1920 * 0.5 * 1 = 960, scaledH = 1080 * 0.5 = 540
    // drawX = (1920 - 960)/2 + 0 = 480, drawY = (1080 - 540)/2 = 270
    const [, dx, dy, dw, dh] = ctx.drawImage.mock.calls[0];
    expect(dw).toBe(960);
    expect(dh).toBe(540);
    expect(dx).toBe(480);
    expect(dy).toBe(270);

    // toCanvas should receive scaled dimensions
    const [, opts] = toCanvasMock.mock.calls[0];
    expect(opts.width).toBe(960);
    expect(opts.height).toBe(540);

    // Component should receive scaled dimensions in props
    const compProps = rootRenderMock.mock.calls[0][0].props.children.props;
    expect(compProps.width).toBe(960);
    expect(compProps.height).toBe(540);
  });

  // ---------------------------------------------------------------------------
  // Resolves component media props (including child :props)
  // ---------------------------------------------------------------------------

  it('resolves component media props (including child :props) before rendering parent component', async () => {
    const Parent = vi.fn(() => null);
    const Child = vi.fn(() => null);

    const parentMedia = makeComponentMedia({
      path: '/media/parent.component.tsx',
      name: 'parent.component.tsx',
      bundlePath: '/bundles/parent.js',
      propDefinitions: {
        child: { type: 'media', default: '', label: 'Child' },
      },
    });
    const childMedia = makeComponentMedia({
      path: '/media/child.component.tsx',
      name: 'child.component.tsx',
      bundlePath: '/bundles/child.js',
    });

    loadComponentMock.mockImplementation(async (bundlePath: string) => {
      if (bundlePath === '/bundles/parent.js') {
        return { Component: Parent, propDefinitions: parentMedia.propDefinitions };
      }
      if (bundlePath === '/bundles/child.js') {
        return { Component: Child, propDefinitions: {} };
      }
      throw new Error(`Unexpected bundle path: ${bundlePath}`);
    });

    const clip = makeClip({
      mediaPath: parentMedia.path,
      mediaName: parentMedia.name,
      componentProps: {
        child: childMedia.path,
        'child:props': { label: 'Nested child' },
      },
    });

    const { exportToVideo } = await import('../../src/utils/canvasExport');
    await exportToVideo(
      [clip], 1280, 720, 1, () => {}, new AbortController().signal, 8_000_000,
      [parentMedia, childMedia], [1],
    );

    const rendered = rootRenderMock.mock.calls[0][0];
    const parentElem = rendered.props.children;
    expect(parentElem.type).toBe(Parent);
    expect(React.isValidElement(parentElem.props.child)).toBe(true);
    expect(parentElem.props.child.type).toBe(Child);
    expect(parentElem.props.child.props.label).toBe('Nested child');
    expect(parentElem.props['child:props']).toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // Offscreen div setup
  // ---------------------------------------------------------------------------

  it('sets up offscreen div with correct css and appends to body', async () => {
    const Comp = vi.fn(() => null);
    const media = makeComponentMedia();
    loadComponentMock.mockResolvedValueOnce({ Component: Comp });

    const clip = makeClip();
    const { exportToVideo } = await import('../../src/utils/canvasExport');
    await exportToVideo(
      [clip], 1920, 1080, 1, () => {}, new AbortController().signal, 8_000_000,
      [media], [1],
    );

    // offscreenDiv should have position fixed and correct dimensions
    expect(offscreenDiv.style.cssText).toContain('1920px');
    expect(offscreenDiv.style.cssText).toContain('1080px');
    expect(offscreenDiv.style.cssText).toContain('position:fixed');

    // Should be appended to body
    expect((globalThis as any).document.body.appendChild).toHaveBeenCalledWith(offscreenDiv);
  });

  // ---------------------------------------------------------------------------
  // Cleanup after export
  // ---------------------------------------------------------------------------

  it('unmounts offscreen root and removes div after export', async () => {
    const Comp = vi.fn(() => null);
    const media = makeComponentMedia();
    loadComponentMock.mockResolvedValueOnce({ Component: Comp });

    const clip = makeClip();
    const { exportToVideo } = await import('../../src/utils/canvasExport');
    await exportToVideo(
      [clip], 1920, 1080, 1, () => {}, new AbortController().signal, 8_000_000,
      [media], [1],
    );

    expect(rootUnmountMock).toHaveBeenCalledTimes(1);
    expect(offscreenDiv.remove).toHaveBeenCalledTimes(1);
  });

  // ---------------------------------------------------------------------------
  // Multiple component clips on different tracks
  // ---------------------------------------------------------------------------

  it('renders multiple component clips on different tracks in correct order', async () => {
    const CompA = vi.fn(() => null);
    const CompB = vi.fn(() => null);

    const mediaA = makeComponentMedia({
      path: '/media/a.tsx',
      name: 'a.tsx',
      bundlePath: '/bundles/a.js',
    });
    const mediaB = makeComponentMedia({
      path: '/media/b.tsx',
      name: 'b.tsx',
      bundlePath: '/bundles/b.js',
    });

    loadComponentMock.mockImplementation(async (bundlePath: string) => {
      if (bundlePath === '/bundles/a.js') return { Component: CompA };
      if (bundlePath === '/bundles/b.js') return { Component: CompB };
      throw new Error(`Unexpected: ${bundlePath}`);
    });

    const clipA = makeClip({ id: 1, mediaPath: mediaA.path, mediaName: mediaA.name, track: 1 });
    const clipB = makeClip({ id: 2, mediaPath: mediaB.path, mediaName: mediaB.name, track: 2 });

    const { exportToVideo } = await import('../../src/utils/canvasExport');
    await exportToVideo(
      [clipA, clipB], 1920, 1080, 1, () => {}, new AbortController().signal, 8_000_000,
      [mediaA, mediaB], [1, 2],
    );

    // Both components should be rendered (2 rootRender calls per frame, 1 frame)
    expect(rootRenderMock).toHaveBeenCalledTimes(2);
    // Both should be drawn
    expect(ctx.drawImage).toHaveBeenCalledTimes(2);

    // Track ordering: higher index draws first (bottom), lower draws last (top)
    // tracks=[1,2]: track 2 (index 1) draws first, track 1 (index 0) draws last
    const firstRendered = rootRenderMock.mock.calls[0][0].props.children;
    const secondRendered = rootRenderMock.mock.calls[1][0].props.children;
    expect(firstRendered.type).toBe(CompB); // track 2 drawn first (bottom)
    expect(secondRendered.type).toBe(CompA); // track 1 drawn last (top)
  });

  // ---------------------------------------------------------------------------
  // Component with rotation applies canvas transform
  // ---------------------------------------------------------------------------

  it('applies rotation transform when component has non-zero rotation', async () => {
    const Comp = vi.fn(() => null);
    const media = makeComponentMedia();
    loadComponentMock.mockResolvedValueOnce({ Component: Comp });

    const clip = makeClip({ rotation: 45 });
    const { exportToVideo } = await import('../../src/utils/canvasExport');
    await exportToVideo(
      [clip], 1920, 1080, 1, () => {}, new AbortController().signal, 8_000_000,
      [media], [1],
    );

    // Should have save/translate/rotate/translate for rotation
    expect(ctx.save).toHaveBeenCalled();
    expect(ctx.rotate).toHaveBeenCalled();
    expect(ctx.restore).toHaveBeenCalled();
    // Component should still be drawn
    expect(ctx.drawImage).toHaveBeenCalledTimes(1);
  });

  // ---------------------------------------------------------------------------
  // Component with mask applies clipping
  // ---------------------------------------------------------------------------

  it('applies mask clipping when component has a shape mask', async () => {
    const Comp = vi.fn(() => null);
    const media = makeComponentMedia();
    loadComponentMock.mockResolvedValueOnce({ Component: Comp });

    const clip = makeClip({
      mask: {
        shape: 'ellipse',
        centerX: 0.5,
        centerY: 0.5,
        width: 0.8,
        height: 0.8,
        rotation: 0,
        feather: 0,
        borderRadius: 0,
        invert: false,
      },
    });
    const { exportToVideo } = await import('../../src/utils/canvasExport');
    await exportToVideo(
      [clip], 1920, 1080, 1, () => {}, new AbortController().signal, 8_000_000,
      [media], [1],
    );

    // Mask should trigger beginPath + ellipse + clip
    expect(ctx.save).toHaveBeenCalled();
    expect(ctx.beginPath).toHaveBeenCalled();
    expect(ctx.ellipse).toHaveBeenCalled();
    expect(ctx.clip).toHaveBeenCalled();
    expect(ctx.restore).toHaveBeenCalled();
    // Component should still be drawn
    expect(ctx.drawImage).toHaveBeenCalledTimes(1);
  });

  // ---------------------------------------------------------------------------
  // Progress reported correctly
  // ---------------------------------------------------------------------------

  it('reports progress during export', async () => {
    const Comp = vi.fn(() => null);
    const media = makeComponentMedia();
    loadComponentMock.mockResolvedValueOnce({ Component: Comp });

    const progressValues: number[] = [];
    const clip = makeClip({ duration: 1 });
    const { exportToVideo } = await import('../../src/utils/canvasExport');
    await exportToVideo(
      [clip], 640, 480, 2, (p) => progressValues.push(p), new AbortController().signal, 8_000_000,
      [media], [1],
    );

    // Should have progress updates (2 frames + final 100%)
    expect(progressValues.length).toBeGreaterThanOrEqual(2);
    // Final progress should be 100
    expect(progressValues[progressValues.length - 1]).toBe(100);
  });

  // ---------------------------------------------------------------------------
  // Abort stops rendering
  // ---------------------------------------------------------------------------

  it('stops rendering when abort signal is triggered', async () => {
    const Comp = vi.fn(() => null);
    const media = makeComponentMedia();
    loadComponentMock.mockResolvedValueOnce({ Component: Comp });

    const abort = new AbortController();
    // Abort immediately
    abort.abort();

    const clip = makeClip({ duration: 10 }); // 10 seconds, many frames
    const { exportToVideo } = await import('../../src/utils/canvasExport');
    await exportToVideo(
      [clip], 640, 480, 30, () => {}, abort.signal, 8_000_000,
      [media], [1],
    );

    // Should not have rendered any frames (aborted before first frame)
    expect(rootRenderMock).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Component clip with media prop pointing to video
  // ---------------------------------------------------------------------------

  it('resolves video media prop to video React element in component props', async () => {
    const Parent = vi.fn(() => null);
    const parentMedia = makeComponentMedia({
      path: '/media/parent.tsx',
      name: 'parent.tsx',
      bundlePath: '/bundles/parent.js',
      propDefinitions: {
        bg: { type: 'media', default: '', label: 'BG' },
      },
    });
    const videoMedia: MediaFile = {
      path: '/media/bg.mp4',
      name: 'bg.mp4',
      ext: '.mp4',
      type: 'video',
      duration: 5,
    };

    loadComponentMock.mockResolvedValueOnce({
      Component: Parent,
      propDefinitions: parentMedia.propDefinitions,
    });

    const clip = makeClip({
      mediaPath: parentMedia.path,
      mediaName: parentMedia.name,
      componentProps: { bg: videoMedia.path },
    });

    const { exportToVideo } = await import('../../src/utils/canvasExport');
    await exportToVideo(
      [clip], 1920, 1080, 1, () => {}, new AbortController().signal, 8_000_000,
      [parentMedia, videoMedia], [1],
    );

    const compProps = rootRenderMock.mock.calls[0][0].props.children.props;
    expect(React.isValidElement(compProps.bg)).toBe(true);
    expect(compProps.bg.type).toBe('video');
  });

  // ---------------------------------------------------------------------------
  // Throws when no renderable clips
  // ---------------------------------------------------------------------------

  it('throws when there are no video, image, or component clips', async () => {
    const audioMedia: MediaFile = {
      path: '/media/a.wav',
      name: 'a.wav',
      ext: '.wav',
      type: 'audio',
      duration: 5,
    };
    const clip = makeClip({ mediaPath: audioMedia.path, mediaName: audioMedia.name });

    const { exportToVideo } = await import('../../src/utils/canvasExport');
    await expect(
      exportToVideo(
        [clip], 1920, 1080, 1, () => {}, new AbortController().signal, 8_000_000,
        [audioMedia], [1],
      ),
    ).rejects.toThrow('No video, image, or component clips to export');
  });
});
