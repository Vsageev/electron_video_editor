import { Muxer, ArrayBufferTarget } from 'webm-muxer';
import type { TimelineClip, MediaFile, ComponentClipProps, PropDefinition, ClipMask } from '../types';
import { getAnimatedTransform, getAnimatedMask } from './keyframeEngine';
import { loadComponent } from './componentLoader';
import { filePathToFileUrl } from './fileUrl';
import { toCanvas } from 'html-to-image';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';

// ---------------------------------------------------------------------------
// Pure helpers — copied from PreviewPanel to guarantee identical output
// ---------------------------------------------------------------------------

function fitSize(nw: number, nh: number, cw: number, ch: number) {
  if (!nw || !nh || !cw || !ch) return { w: 0, h: 0 };
  const aspect = nw / nh;
  return aspect > cw / ch
    ? { w: cw, h: cw / aspect }
    : { w: ch * aspect, h: ch };
}

function makeTransformStyle(
  x: number,
  y: number,
  scale: number,
  bw: number,
  bh: number,
  sX = 1,
  sY = 1,
  rotation = 0,
): React.CSSProperties {
  return {
    position: 'absolute',
    width: bw * scale * sX,
    height: bh * scale * sY,
    left: '50%',
    top: '50%',
    transform: `translate(calc(-50% + ${x * bw}px), calc(-50% + ${y * bh}px))${rotation ? ` rotate(${rotation}deg)` : ''}`,
  };
}

function buildClipPath(mask: ClipMask): string {
  const cx = mask.centerX * 100;
  const cy = mask.centerY * 100;
  const hw = (mask.width / 2) * 100;
  const hh = (mask.height / 2) * 100;

  if (mask.shape === 'ellipse') {
    const inner = `ellipse(${hw}% ${hh}% at ${cx}% ${cy}%)`;
    if (!mask.invert) return inner;
    return `polygon(evenodd, 0% 0%, 100% 0%, 100% 100%, 0% 100%, 0% 0%, ${cx - hw}% ${cy}%, ${cx}% ${cy - hh}%, ${cx + hw}% ${cy}%, ${cx}% ${cy + hh}%, ${cx - hw}% ${cy}%)`;
  }

  const top = cy - hh;
  const right = 100 - (cx + hw);
  const bottom = 100 - (cy + hh);
  const left = cx - hw;
  const r = mask.borderRadius * Math.min(hw, hh) * 2;
  const rStr = r > 0 ? ` round ${r}%` : '';

  if (!mask.invert) {
    return `inset(${top}% ${right}% ${bottom}% ${left}%${rStr})`;
  }
  const l = left;
  const t = top;
  const rr = 100 - right;
  const bb = 100 - bottom;
  return `polygon(evenodd, 0% 0%, 100% 0%, 100% 100%, 0% 100%, 0% 0%, ${l}% ${t}%, ${rr}% ${t}%, ${rr}% ${bb}%, ${l}% ${bb}%, ${l}% ${t}%)`;
}

// ---------------------------------------------------------------------------
// Media helpers
// ---------------------------------------------------------------------------

function waitForSeek(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve) => {
    if (Math.abs(video.currentTime - time) < 0.01) {
      resolve();
      return;
    }
    const onSeeked = () => {
      video.removeEventListener('seeked', onSeeked);
      resolve();
    };
    video.addEventListener('seeked', onSeeked);
    video.currentTime = time;
  });
}

function loadVideo(src: string): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.muted = true;
    video.preload = 'auto';
    video.playsInline = true;
    video.src = src;
    video.onloadeddata = () => resolve(video);
    video.onerror = () => reject(new Error(`Failed to load video: ${src}`));
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.src = src;
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${src}`));
  });
}

/** Seek a video to the given time and draw the current frame to a data URL. */
async function captureVideoFrame(video: HTMLVideoElement, time: number): Promise<string> {
  await waitForSeek(video, Math.max(0, time));
  const c = document.createElement('canvas');
  c.width = video.videoWidth || 640;
  c.height = video.videoHeight || 360;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(video, 0, 0, c.width, c.height);
  return c.toDataURL('image/png');
}

// ---------------------------------------------------------------------------
// Component prop resolution for export
// ---------------------------------------------------------------------------

type ComponentEntry = {
  Component: React.ComponentType<any>;
  propDefinitions?: Record<string, PropDefinition>;
};

export function resolveComponentPropsForExport(
  componentProps: Record<string, any> | undefined,
  propDefinitions: Record<string, PropDefinition> | undefined,
  clipProps: ComponentClipProps,
  mediaByPath: Map<string, MediaFile>,
  componentEntriesByMediaPath: Map<string, ComponentEntry>,
  videoFrameUrls?: Map<string, string>,
): Record<string, any> {
  if (!componentProps || !propDefinitions) return componentProps || {};

  const resolved: Record<string, any> = { ...componentProps };

  for (const [key, def] of Object.entries(propDefinitions)) {
    if (def.type !== 'media') continue;
    const path = componentProps[key];
    const nestedPropsKey = `${key}:props`;
    if (!path) {
      delete resolved[nestedPropsKey];
      continue;
    }

    const media = mediaByPath.get(path);
    if (!media) {
      delete resolved[nestedPropsKey];
      continue;
    }

    if (media.type === 'component') {
      const childEntry = componentEntriesByMediaPath.get(media.path);
      if (childEntry) {
        const childProps = componentProps[nestedPropsKey] as Record<string, any> | undefined;
        resolved[key] = React.createElement(childEntry.Component, {
          ...clipProps,
          ...(childProps || {}),
        });
      } else {
        resolved[key] = null;
      }
    } else if (media.type === 'video') {
      const frameUrl = videoFrameUrls?.get(media.path);
      resolved[key] = React.createElement('img', {
        src: frameUrl || filePathToFileUrl(media.path),
        style: { width: '100%', height: '100%', objectFit: 'contain' },
        draggable: false,
      });
    } else if (media.type === 'image') {
      resolved[key] = React.createElement('img', {
        src: filePathToFileUrl(media.path),
        style: { width: '100%', height: '100%', objectFit: 'contain' },
        draggable: false,
      });
    } else {
      resolved[key] = null;
    }

    delete resolved[nestedPropsKey];
  }

  return resolved;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export async function exportToVideo(
  clips: TimelineClip[],
  width: number,
  height: number,
  fps: number,
  onProgress: (percent: number) => void,
  abortSignal: AbortSignal,
  bitrate: number = 8_000_000,
  mediaFiles: MediaFile[] = [],
  tracks: number[] = [],
): Promise<Blob> {
  const mediaByPath = new Map(mediaFiles.map((m) => [m.path, m]));
  const getMediaType = (clip: TimelineClip) => {
    const mf = mediaByPath.get(clip.mediaPath);
    return mf?.type ?? 'video';
  };

  const renderableClips = clips.filter((c) => {
    const t = getMediaType(c);
    return t === 'video' || t === 'image' || t === 'component';
  });
  const videoClips = renderableClips.filter((c) => getMediaType(c) === 'video');
  const componentClips = renderableClips.filter((c) => getMediaType(c) === 'component');
  const imageClips = renderableClips.filter((c) => getMediaType(c) === 'image');

  const trackOrder = tracks.length > 0
    ? tracks
    : Array.from(new Set(clips.map((c) => c.track))).sort((a, b) => a - b);
  const trackOrderMap = new Map(trackOrder.map((track, idx) => [track, idx]));
  const sortedRenderableClips = [...renderableClips].sort((a, b) => {
    const ai = trackOrderMap.get(a.track) ?? Number.MAX_SAFE_INTEGER;
    const bi = trackOrderMap.get(b.track) ?? Number.MAX_SAFE_INTEGER;
    return bi - ai;
  });

  if (videoClips.length === 0 && componentClips.length === 0 && imageClips.length === 0) {
    throw new Error('No video, image, or component clips to export');
  }

  const totalDuration = Math.max(...clips.map((c) => c.startTime + c.duration));
  const totalFrames = Math.ceil(totalDuration * fps);
  const frameDuration = 1 / fps;

  // Final compositing canvas for VideoEncoder
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  // Load all video elements
  const videoElements: Map<number, HTMLVideoElement> = new Map();
  const videoNaturalSizes: Map<number, { w: number; h: number }> = new Map();
  await Promise.all(
    videoClips.map(async (clip) => {
      const video = await loadVideo(filePathToFileUrl(clip.mediaPath));
      videoElements.set(clip.id, video);
      videoNaturalSizes.set(clip.id, { w: video.videoWidth, h: video.videoHeight });
    }),
  );

  // Load all image elements and capture natural sizes
  const imageNaturalSizes: Map<number, { w: number; h: number }> = new Map();
  await Promise.all(
    imageClips.map(async (clip) => {
      const img = await loadImage(filePathToFileUrl(clip.mediaPath));
      imageNaturalSizes.set(clip.id, { w: img.naturalWidth, h: img.naturalHeight });
    }),
  );

  // Load component bundles
  const componentEntriesByMediaPath: Map<string, ComponentEntry> = new Map();
  await Promise.all(
    mediaFiles
      .filter((m) => m.type === 'component' && !!m.bundlePath)
      .map(async (m) => {
        try {
          const entry = await loadComponent(m.bundlePath!);
          componentEntriesByMediaPath.set(m.path, {
            Component: entry.Component,
            propDefinitions: entry.propDefinitions,
          });
        } catch (e) {
          console.warn(`Could not load component media ${m.name}:`, e);
        }
      }),
  );

  const componentEntriesByClipId: Map<number, ComponentEntry> = new Map();
  for (const clip of componentClips) {
    const entry = componentEntriesByMediaPath.get(clip.mediaPath);
    if (entry) {
      componentEntriesByClipId.set(clip.id, entry);
    } else {
      console.warn(`Component clip ${clip.mediaName} has no loaded component entry`);
    }
  }

  // Pre-load videos referenced as media props inside component clips
  const mediaPropVideos: Map<string, HTMLVideoElement> = new Map();
  for (const clip of componentClips) {
    const entry = componentEntriesByClipId.get(clip.id);
    if (!entry?.propDefinitions || !clip.componentProps) continue;
    for (const [key, def] of Object.entries(entry.propDefinitions)) {
      if (def.type !== 'media') continue;
      const path = clip.componentProps[key];
      if (!path || mediaPropVideos.has(path)) continue;
      const media = mediaByPath.get(path);
      if (media?.type === 'video') {
        try {
          const video = await loadVideo(filePathToFileUrl(media.path));
          mediaPropVideos.set(path, video);
        } catch (e) {
          console.warn(`Could not load media-prop video ${path}:`, e);
        }
      }
    }
  }

  // Offscreen container for DOM-based rasterization
  const offscreenDiv = document.createElement('div');
  offscreenDiv.style.cssText = `position:fixed;left:0;top:0;pointer-events:none;opacity:0;`;
  document.body.appendChild(offscreenDiv);
  const offscreenContent = document.createElement('div');
  offscreenContent.style.cssText = `position:relative;margin:0;padding:0;box-sizing:border-box;overflow:hidden;background:#000;width:${width}px;height:${height}px;`;
  offscreenDiv.appendChild(offscreenContent);
  const offscreenRoot = createRoot(offscreenContent);

  // Set up muxer with video + audio
  const hasAudio = true;
  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: {
      codec: 'V_VP9',
      width,
      height,
    },
    audio: hasAudio
      ? {
          codec: 'A_OPUS',
          sampleRate: 48000,
          numberOfChannels: 2,
        }
      : undefined,
    firstTimestampBehavior: 'offset',
  });

  // Set up VideoEncoder
  const videoEncoder = new VideoEncoder({
    output: (chunk, meta) => {
      muxer.addVideoChunk(chunk, meta ?? undefined);
    },
    error: (e) => {
      console.error('VideoEncoder error:', e);
    },
  });

  videoEncoder.configure({
    codec: 'vp09.00.10.08',
    width,
    height,
    bitrate,
    framerate: fps,
  });

  const LOGICAL_BASE = 960;
  const exportAspect = width / height;

  // Render video frame by frame
  for (let frameIdx = 0; frameIdx < totalFrames; frameIdx++) {
    if (abortSignal.aborted) break;

    const timelineTime = frameIdx * frameDuration;

    // Find visible clips at this frame
    const visibleClips = sortedRenderableClips.filter((clip) => {
      const clipEnd = clip.startTime + clip.duration;
      return timelineTime >= clip.startTime && timelineTime < clipEnd;
    });

    // Capture video frames as data URLs (html-to-image can't rasterize <video>)
    const videoFrameDataUrls: Map<number, string> = new Map();
    for (const clip of visibleClips) {
      if (getMediaType(clip) !== 'video') continue;
      const video = videoElements.get(clip.id)!;
      const clipLocalTime = clip.trimStart + (timelineTime - clip.startTime);
      const dataUrl = await captureVideoFrame(video, clipLocalTime);
      videoFrameDataUrls.set(clip.id, dataUrl);
    }

    // Also capture frames for video media props inside component clips
    const mediaPropFrameUrls: Map<string, string> = new Map();
    for (const clip of visibleClips) {
      if (getMediaType(clip) !== 'component') continue;
      const entry = componentEntriesByClipId.get(clip.id);
      if (!entry?.propDefinitions || !clip.componentProps) continue;
      const currentTime = timelineTime - clip.startTime;
      for (const [key, def] of Object.entries(entry.propDefinitions)) {
        if (def.type !== 'media') continue;
        const path = clip.componentProps[key];
        if (!path || mediaPropFrameUrls.has(path)) continue;
        const media = mediaByPath.get(path);
        if (media?.type !== 'video') continue;
        const video = mediaPropVideos.get(path);
        if (video) {
          mediaPropFrameUrls.set(path, await captureVideoFrame(video, currentTime));
        }
      }
    }

    // Build React element tree mirroring PreviewPanel's .canvas-rect structure
    const clipElements: React.ReactElement[] = [];

    for (const clip of visibleClips) {
      const mediaType = getMediaType(clip);
      const animTime = timelineTime - clip.startTime;
      const { x, y, scale, scaleX, scaleY, rotation } = getAnimatedTransform(clip, animTime);
      const animMask = getAnimatedMask(clip, animTime);

      // Compute base size — same logic as PreviewPanel
      let base: { w: number; h: number };
      if (mediaType === 'video') {
        const nat = videoNaturalSizes.get(clip.id);
        base = nat ? fitSize(nat.w, nat.h, width, height) : { w: width, h: height };
      } else if (mediaType === 'image') {
        const nat = imageNaturalSizes.get(clip.id);
        base = nat ? fitSize(nat.w, nat.h, width, height) : { w: width, h: height };
      } else {
        // component — base is canvas size
        base = { w: width, h: height };
      }

      // Build transform style — identical to PreviewPanel
      const style: React.CSSProperties = base.w > 0
        ? {
            ...makeTransformStyle(x, y, scale, base.w, base.h, scaleX, scaleY, rotation),
            ...(animMask ? { overflow: 'hidden' as const } : {}),
            ...(animMask ? { clipPath: buildClipPath(animMask) } : {}),
            ...(animMask && animMask.feather > 0 ? { filter: `blur(${animMask.feather}px)` } : {}),
          }
        : { position: 'absolute' as const, opacity: 0, pointerEvents: 'none' as const };

      let content: React.ReactElement;

      if (mediaType === 'video') {
        const dataUrl = videoFrameDataUrls.get(clip.id)!;
        content = React.createElement('img', {
          src: dataUrl,
          style: { width: '100%', height: '100%', objectFit: 'contain' },
          draggable: false,
        });
      } else if (mediaType === 'image') {
        content = React.createElement('img', {
          src: filePathToFileUrl(clip.mediaPath),
          style: { width: '100%', height: '100%', objectFit: 'contain' },
          draggable: false,
        });
      } else {
        // component
        const entry = componentEntriesByClipId.get(clip.id);
        if (!entry) continue;

        const currentTime = animTime;
        const progress = clip.duration > 0 ? currentTime / clip.duration : 0;
        const containerW = base.w * scale * scaleX;
        const containerH = base.h * scale * scaleY;

        // Same logical sizing as ComponentRenderer in ClipLayer
        const logicalW = LOGICAL_BASE;
        const containerAspect = containerH > 0 ? containerW / containerH : exportAspect;
        const logicalH = LOGICAL_BASE / containerAspect;
        const cssScale = containerW > 0 ? containerW / logicalW : 1;

        const clipProps: ComponentClipProps = {
          currentTime,
          duration: clip.duration,
          width: logicalW,
          height: logicalH,
          progress,
        };

        const resolvedProps = resolveComponentPropsForExport(
          clip.componentProps,
          entry.propDefinitions,
          clipProps,
          mediaByPath,
          componentEntriesByMediaPath,
          mediaPropFrameUrls,
        );

        // Mirror ClipLayer's ComponentRenderer DOM structure:
        // <div style={{width:'100%',height:'100%',overflow:'hidden'}}>
        //   <div style={{width:logicalW,height:logicalH,transform:scale(cssScale),transformOrigin:'top left'}}>
        //     <Component {...clipProps} {...resolvedProps} />
        //   </div>
        // </div>
        content = React.createElement('div', {
          style: { width: '100%', height: '100%', overflow: 'hidden' },
        },
          React.createElement('div', {
            style: {
              width: logicalW,
              height: logicalH,
              transform: `scale(${cssScale})`,
              transformOrigin: 'top left',
            },
          },
            React.createElement(entry.Component, {
              ...clipProps,
              ...resolvedProps,
            }),
          ),
        );
      }

      clipElements.push(
        React.createElement('div', { key: clip.id, style }, content),
      );
    }

    // Build the full composite tree (mirrors .canvas-rect)
    const compositeTree = React.createElement('div', {
      style: {
        width: '100%',
        height: '100%',
        position: 'relative',
      },
    }, ...clipElements);

    // Render into offscreen container
    flushSync(() => {
      offscreenRoot.render(compositeTree);
    });

    // Wait for browser to paint
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));

    // Rasterize the entire composite at export resolution
    const rasterCanvas = await toCanvas(offscreenContent, {
      width,
      height,
      pixelRatio: 1,
      skipAutoScale: true,
    });

    // Draw onto the encoding canvas
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(rasterCanvas, 0, 0);

    // Create VideoFrame and encode
    const timestamp = frameIdx * frameDuration * 1_000_000; // microseconds
    const frame = new VideoFrame(canvas, {
      timestamp,
      duration: frameDuration * 1_000_000,
    });

    const keyFrame = frameIdx % (fps * 2) === 0; // keyframe every 2 seconds
    videoEncoder.encode(frame, { keyFrame });
    frame.close();

    // Report progress (leave last 5% for audio + finalization)
    const percent = Math.round((frameIdx / totalFrames) * 95);
    onProgress(percent);

    // Yield to UI thread periodically
    if (frameIdx % 5 === 0) {
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  // Flush remaining video frames
  await videoEncoder.flush();

  // Render audio offline: timeline video/audio clips + videos embedded as
  // component media props (so child videos inside components are not muted).
  const audioSourceClips = clips.filter((c) => {
    const t = getMediaType(c);
    return t === 'video' || t === 'audio';
  });

  // Collect audio sources from video media props inside component clips.
  type AudioSource = { mediaPath: string; startTime: number; trimStart: number; duration: number; mediaName: string };
  const extraAudioSources: AudioSource[] = [];
  for (const clip of componentClips) {
    const entry = componentEntriesByClipId.get(clip.id);
    if (!entry?.propDefinitions || !clip.componentProps) continue;
    for (const [key, def] of Object.entries(entry.propDefinitions)) {
      if (def.type !== 'media') continue;
      const path = clip.componentProps[key];
      if (!path) continue;
      const media = mediaByPath.get(path);
      if (media?.type === 'video') {
        extraAudioSources.push({
          mediaPath: media.path,
          startTime: clip.startTime,
          trimStart: 0,
          duration: clip.duration,
          mediaName: media.name,
        });
      }
    }
  }

  if (hasAudio && (audioSourceClips.length > 0 || extraAudioSources.length > 0)) {
    try {
      await renderAudio(audioSourceClips, totalDuration, muxer, extraAudioSources);
    } catch (e) {
      console.warn('Audio encoding failed, exporting without audio:', e);
    }
  }

  muxer.finalize();
  videoEncoder.close();

  // Clean up video elements, media-prop videos, and offscreen container
  for (const v of videoElements.values()) v.src = '';
  for (const v of mediaPropVideos.values()) v.src = '';
  offscreenRoot.unmount();
  offscreenDiv.remove();

  onProgress(100);

  const { buffer } = target;
  return new Blob([buffer], { type: 'video/webm' });
}

async function renderAudio(
  videoClips: TimelineClip[],
  totalDuration: number,
  muxer: Muxer<ArrayBufferTarget>,
  extraAudioSources: { mediaPath: string; startTime: number; trimStart: number; duration: number; mediaName: string }[] = [],
) {
  const sampleRate = 48000;
  const numberOfChannels = 2;

  // Decode audio from each clip
  const audioCtx = new AudioContext({ sampleRate });
  const offlineCtx = new OfflineAudioContext(
    numberOfChannels,
    Math.ceil(totalDuration * sampleRate),
    sampleRate,
  );

  // Helper to schedule an audio source into the offline context
  const scheduleAudioSource = async (
    mediaPath: string, startTime: number, trimStart: number, duration: number, label: string,
  ) => {
    try {
      const fileBuffer = await window.api.readFile(mediaPath);
      const audioBuffer = await offlineCtx.decodeAudioData(fileBuffer.slice(0));

      const source = offlineCtx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(offlineCtx.destination);

      source.start(startTime, trimStart, duration);
    } catch (e) {
      console.warn(`Could not decode audio for ${label}:`, e);
    }
  };

  for (const clip of videoClips) {
    await scheduleAudioSource(clip.mediaPath, clip.startTime, clip.trimStart, clip.duration, clip.mediaName);
  }

  // Include audio from videos embedded as component media props
  for (const src of extraAudioSources) {
    await scheduleAudioSource(src.mediaPath, src.startTime, src.trimStart, src.duration, src.mediaName);
  }

  const renderedBuffer = await offlineCtx.startRendering();
  audioCtx.close();

  // Encode audio with AudioEncoder
  const audioEncoder = new AudioEncoder({
    output: (chunk, meta) => {
      muxer.addAudioChunk(chunk, meta ?? undefined);
    },
    error: (e) => {
      console.error('AudioEncoder error:', e);
    },
  });

  audioEncoder.configure({
    codec: 'opus',
    sampleRate,
    numberOfChannels,
    bitrate: 128_000,
  });

  // Feed audio in chunks of 960 samples (20ms at 48kHz, Opus frame size)
  const chunkSize = 960;
  const totalSamples = renderedBuffer.length;

  for (let offset = 0; offset < totalSamples; offset += chunkSize) {
    const remaining = Math.min(chunkSize, totalSamples - offset);

    const planarData = new Float32Array(remaining * numberOfChannels);
    for (let ch = 0; ch < numberOfChannels; ch++) {
      const channelData = renderedBuffer.getChannelData(ch);
      planarData.set(channelData.subarray(offset, offset + remaining), ch * remaining);
    }

    const audioData = new AudioData({
      format: 'f32-planar',
      sampleRate,
      numberOfFrames: remaining,
      numberOfChannels,
      timestamp: (offset / sampleRate) * 1_000_000, // microseconds
      data: planarData,
    });

    audioEncoder.encode(audioData);
    audioData.close();
  }

  await audioEncoder.flush();
  audioEncoder.close();
}
