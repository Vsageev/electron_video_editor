/**
 * @vitest-environment jsdom
 *
 * Tests that verify actual React rendering in the export pipeline.
 * Uses real React (createRoot, flushSync) — NOT mocked — so we can
 * verify the offscreen div actually has DOM content before toCanvas
 * is invoked.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MediaFile, TimelineClip } from '../../src/types';
import { exportToVideo } from '../../src/utils/canvasExport';

// ---------------------------------------------------------------------------
// Mocks — only mock what jsdom can't provide (no react-dom mocks!)
// ---------------------------------------------------------------------------

const { loadComponentMock, toCanvasMock } = vi.hoisted(() => ({
  loadComponentMock: vi.fn(),
  toCanvasMock: vi.fn(),
}));

vi.mock('../../src/utils/componentLoader', () => ({
  loadComponent: loadComponentMock,
}));

vi.mock('html-to-image', () => ({
  toCanvas: toCanvasMock,
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Setup browser globals that jsdom lacks
// ---------------------------------------------------------------------------

let drawImageCalls: any[][];
let ctxMock: Record<string, any>;

// Capture the REAL document.createElement ONCE (before any spying)
const realCreateElement = Document.prototype.createElement;

beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();

  drawImageCalls = [];
  ctxMock = {
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
    drawImage: vi.fn((...args: any[]) => drawImageCalls.push(args)),
  };

  // jsdom doesn't support canvas rendering — mock getContext on HTMLCanvasElement
  // This avoids intercepting document.createElement which could interfere with React
  if (typeof HTMLCanvasElement !== 'undefined') {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctxMock as any);
  }

  // Stub encode/frame APIs
  (globalThis as any).VideoFrame = class {
    constructor(_: any, __: any) {}
    close() {}
  };
  (globalThis as any).VideoEncoder = class {
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
  };
  (globalThis as any).window ??= globalThis;
  (globalThis as any).window.api = { readFile: vi.fn() };

  // Default toCanvas mock
  toCanvasMock.mockResolvedValue(
    realCreateElement.call(document, 'div'), // just a dummy node
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('exportToVideo real React rendering', () => {
  // Baseline test: verify that createRoot + flushSync + render actually commits to DOM
  it('baseline: flushSync + createRoot.render commits to real DOM synchronously', async () => {
    const { createRoot } = await import('react-dom/client');
    const { flushSync } = await import('react-dom');

    const container = realCreateElement.call(document, 'div');
    document.body.appendChild(container);
    const root = createRoot(container);

    flushSync(() => {
      root.render(
        React.createElement('div', { 'data-testid': 'baseline' }, 'hello'),
      );
    });

    const el = container.querySelector('[data-testid="baseline"]');
    expect(el).not.toBeNull();
    expect(el!.textContent).toBe('hello');

    root.unmount();
    container.remove();
  });

  // Test if an await between createRoot and flushSync breaks DOM commit
  it('baseline: flushSync still commits after awaiting between createRoot and render', async () => {
    const { createRoot } = await import('react-dom/client');
    const { flushSync } = await import('react-dom');

    const container = realCreateElement.call(document, 'div');
    document.body.appendChild(container);
    const root = createRoot(container);

    // Simulate async gap (like loading videos/components)
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));

    flushSync(() => {
      root.render(
        React.createElement('div', { 'data-testid': 'delayed' }, 'after-await'),
      );
    });

    const el = container.querySelector('[data-testid="delayed"]');
    expect(el).not.toBeNull();
    expect(el!.textContent).toBe('after-await');

    root.unmount();
    container.remove();
  });

  it('offscreen div has actual rendered DOM content when toCanvas is called', async () => {
    const TestComp = (props: any) =>
      React.createElement(
        'div',
        { 'data-testid': 'comp-output' },
        React.createElement('span', null, `t=${props.currentTime}`),
      );

    const media = makeComponentMedia();
    loadComponentMock.mockResolvedValueOnce({ Component: TestComp });

    // Check DOM content INSIDE the toCanvas callback (before unmount clears it)
    let domContentDuringToCanvas: string | null = null;
    let testOutputText: string | null = null;
    toCanvasMock.mockImplementation(async (node: HTMLElement) => {
      domContentDuringToCanvas = node.innerHTML;
      const testOutput = node.querySelector('[data-testid="comp-output"]');
      testOutputText = testOutput?.textContent ?? null;
      return realCreateElement.call(document, 'div');
    });

    const clip = makeClip();
    await exportToVideo(
      [clip], 1920, 1080, 1, () => {},
      new AbortController().signal, 8_000_000, [media], [1],
    );

    expect(toCanvasMock).toHaveBeenCalled();
    expect(domContentDuringToCanvas).not.toBe('');
    expect(testOutputText).toBe('t=0');
  });

  it('component receives correct clipProps on first frame via real React render', async () => {
    const allReceivedProps: any[] = [];
    const TestComp = (props: any) => {
      allReceivedProps.push({ ...props });
      return React.createElement('div', null, 'rendered');
    };

    const media = makeComponentMedia();
    loadComponentMock.mockResolvedValueOnce({ Component: TestComp });

    const clip = makeClip({ duration: 4 });
    await exportToVideo(
      [clip], 1920, 1080, 1, () => {},
      new AbortController().signal, 8_000_000, [media], [1],
    );

    // Check the FIRST frame's props (not the last)
    expect(allReceivedProps.length).toBeGreaterThan(0);
    const firstFrameProps = allReceivedProps[0];
    expect(firstFrameProps.currentTime).toBe(0);
    expect(firstFrameProps.duration).toBe(4);
    expect(firstFrameProps.width).toBe(1920);
    expect(firstFrameProps.height).toBe(1080);
    expect(firstFrameProps.progress).toBe(0);
  });

  it('component with custom componentProps receives them merged with clipProps', async () => {
    let receivedProps: any = null;
    const TestComp = (props: any) => {
      receivedProps = { ...props };
      return React.createElement('div', null, props.title);
    };

    const media = makeComponentMedia();
    loadComponentMock.mockResolvedValueOnce({
      Component: TestComp,
      propDefinitions: undefined,
    });

    const clip = makeClip({ componentProps: { title: 'Hello Export' } });
    await exportToVideo(
      [clip], 1920, 1080, 1, () => {},
      new AbortController().signal, 8_000_000, [media], [1],
    );

    expect(receivedProps).not.toBeNull();
    // Should have both clipProps and componentProps
    expect(receivedProps.currentTime).toBe(0);
    expect(receivedProps.title).toBe('Hello Export');
  });

  it('renders component on every visible frame with advancing currentTime', async () => {
    const renderTimes: number[] = [];
    const TestComp = (props: any) => {
      renderTimes.push(props.currentTime);
      return React.createElement('div', null, `t=${props.currentTime}`);
    };

    const media = makeComponentMedia();
    loadComponentMock.mockResolvedValueOnce({ Component: TestComp });

    // 1s clip at 3fps = 3 frames
    const clip = makeClip({ duration: 1 });
    await exportToVideo(
      [clip], 640, 480, 3, () => {},
      new AbortController().signal, 8_000_000, [media], [1],
    );

    expect(renderTimes.length).toBe(3);
    expect(renderTimes[0]).toBeCloseTo(0);
    expect(renderTimes[1]).toBeCloseTo(1 / 3);
    expect(renderTimes[2]).toBeCloseTo(2 / 3);
  });

  it('drawImage is called for each rendered component frame', async () => {
    const TestComp = () => React.createElement('div', null, 'content');

    const media = makeComponentMedia();
    loadComponentMock.mockResolvedValueOnce({ Component: TestComp });

    const clip = makeClip({ duration: 1 });
    await exportToVideo(
      [clip], 1920, 1080, 2, () => {},
      new AbortController().signal, 8_000_000, [media], [1],
    );

    // 2 frames, each should draw
    expect(drawImageCalls.length).toBe(2);
  });

  it('resolves media-type props to React elements in rendered output', async () => {
    let receivedProps: any = null;
    const Parent = (props: any) => {
      receivedProps = { ...props };
      return React.createElement('div', null, 'parent');
    };

    const parentMedia = makeComponentMedia({
      path: '/media/parent.tsx',
      name: 'parent.tsx',
      bundlePath: '/bundles/parent.js',
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
      propDefinitions: { bg: { type: 'media', default: '', label: 'BG' } },
    });

    const clip = makeClip({
      mediaPath: parentMedia.path,
      mediaName: parentMedia.name,
      componentProps: { bg: videoMedia.path },
    });

    await exportToVideo(
      [clip], 1920, 1080, 1, () => {},
      new AbortController().signal, 8_000_000, [parentMedia, videoMedia], [1],
    );

    expect(receivedProps).not.toBeNull();
    // bg prop should be a React video element, not a raw string
    expect(React.isValidElement(receivedProps.bg)).toBe(true);
    expect((receivedProps.bg as any).type).toBe('video');
  });

  it('wrapper div dimensions match scaledW x scaledH in the real DOM', async () => {
    const TestComp = () => React.createElement('div', null, 'content');
    const media = makeComponentMedia();
    loadComponentMock.mockResolvedValueOnce({ Component: TestComp });

    // Check wrapper dimensions INSIDE the toCanvas callback
    let wrapperWidth: string | null = null;
    let wrapperHeight: string | null = null;
    toCanvasMock.mockImplementation(async (node: HTMLElement) => {
      const wrapper = node.firstElementChild as HTMLElement;
      wrapperWidth = wrapper?.style.width ?? null;
      wrapperHeight = wrapper?.style.height ?? null;
      return realCreateElement.call(document, 'div');
    });

    const clip = makeClip({ scale: 0.5 });
    await exportToVideo(
      [clip], 1920, 1080, 1, () => {},
      new AbortController().signal, 8_000_000, [media], [1],
    );

    expect(toCanvasMock).toHaveBeenCalled();
    expect(wrapperWidth).toBe('960px');
    expect(wrapperHeight).toBe('540px');
  });

  it('cleans up offscreen div from body after export completes', async () => {
    const TestComp = () => React.createElement('div', null, 'content');
    const media = makeComponentMedia();
    loadComponentMock.mockResolvedValueOnce({ Component: TestComp });

    const clip = makeClip();
    await exportToVideo(
      [clip], 1920, 1080, 1, () => {},
      new AbortController().signal, 8_000_000, [media], [1],
    );

    // Offscreen div should be removed from body
    const offscreenDivs = document.querySelectorAll('div[style*="-9999px"]');
    expect(offscreenDivs.length).toBe(0);
  });
});
