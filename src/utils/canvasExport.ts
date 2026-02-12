import { Muxer, ArrayBufferTarget } from 'webm-muxer';
import type { TimelineClip, MediaFile, ComponentClipProps, PropDefinition } from '../types';
import { getAnimatedTransform, getAnimatedMask } from './keyframeEngine';
import { loadComponent } from './componentLoader';
import { filePathToFileUrl } from './fileUrl';
import { toCanvas } from 'html-to-image';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';

function fitSize(nw: number, nh: number, cw: number, ch: number) {
  if (!nw || !nh || !cw || !ch) return { w: 0, h: 0 };
  const aspect = nw / nh;
  return aspect > cw / ch
    ? { w: cw, h: cw / aspect }
    : { w: ch * aspect, h: ch };
}

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

function drawMaskShapePath(
  ctx: CanvasRenderingContext2D,
  drawX: number,
  drawY: number,
  drawW: number,
  drawH: number,
  mask: NonNullable<ReturnType<typeof getAnimatedMask>>,
) {
  const mcx = drawX + mask.centerX * drawW;
  const mcy = drawY + mask.centerY * drawH;
  const mw = (mask.width / 2) * drawW;
  const mh = (mask.height / 2) * drawH;
  if (mask.shape === 'ellipse') {
    ctx.ellipse(mcx, mcy, mw, mh, 0, 0, Math.PI * 2);
    return;
  }

  const rx = mask.borderRadius * Math.min(mw, mh) * 2;
  if (rx > 0) {
    const lx = mcx - mw;
    const ly = mcy - mh;
    const rw = mw * 2;
    const rh = mh * 2;
    ctx.moveTo(lx + rx, ly);
    ctx.lineTo(lx + rw - rx, ly);
    ctx.arcTo(lx + rw, ly, lx + rw, ly + rx, rx);
    ctx.lineTo(lx + rw, ly + rh - rx);
    ctx.arcTo(lx + rw, ly + rh, lx + rw - rx, ly + rh, rx);
    ctx.lineTo(lx + rx, ly + rh);
    ctx.arcTo(lx, ly + rh, lx, ly + rh - rx, rx);
    ctx.lineTo(lx, ly + rx);
    ctx.arcTo(lx, ly, lx + rx, ly, rx);
    ctx.closePath();
    return;
  }

  ctx.rect(mcx - mw, mcy - mh, mw * 2, mh * 2);
}

function withTransformAndMask(
  ctx: CanvasRenderingContext2D,
  drawX: number,
  drawY: number,
  drawW: number,
  drawH: number,
  rotation: number,
  mask: NonNullable<ReturnType<typeof getAnimatedMask>> | null,
  draw: () => void,
) {
  const hasRotation = rotation !== 0;
  if (hasRotation) {
    ctx.save();
    ctx.translate(drawX + drawW / 2, drawY + drawH / 2);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.translate(-(drawX + drawW / 2), -(drawY + drawH / 2));
  }

  if (mask) {
    ctx.save();
    ctx.beginPath();
    if (mask.invert) {
      ctx.rect(drawX, drawY, drawW, drawH);
    }
    drawMaskShapePath(ctx, drawX, drawY, drawW, drawH, mask);
    ctx.clip(mask.invert ? 'evenodd' : 'nonzero');
  }

  const prevFilter = ctx.filter;
  if (mask && mask.feather > 0) {
    ctx.filter = `blur(${mask.feather}px)`;
  }
  draw();
  ctx.filter = prevFilter;

  if (mask) {
    ctx.restore();
  }
  if (hasRotation) {
    ctx.restore();
  }
}

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
      // Use pre-captured frame data URL so html-to-image can rasterize it
      // (html-to-image cannot reliably capture <video> elements)
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

  // Create canvas
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  // Load all video elements
  const videoElements: Map<number, HTMLVideoElement> = new Map();
  await Promise.all(
    videoClips.map(async (clip) => {
      const video = await loadVideo(filePathToFileUrl(clip.mediaPath));
      videoElements.set(clip.id, video);
    }),
  );

  // Load all image elements
  const imageElements: Map<number, HTMLImageElement> = new Map();
  await Promise.all(
    imageClips.map(async (clip) => {
      const img = await loadImage(filePathToFileUrl(clip.mediaPath));
      imageElements.set(clip.id, img);
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
  // so we can seek + capture frames per-frame instead of using <video> elements
  // (html-to-image cannot reliably rasterize <video>).
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

  // Offscreen container for component rasterization.
  // The outer wrapper is invisible (opacity:0) but still painted by the browser,
  // so html-to-image can read accurate computed styles on the inner content.
  // opacity on the parent does NOT propagate to the cloned node's inline styles.
  const offscreenDiv = document.createElement('div');
  offscreenDiv.style.cssText = `position:fixed;left:0;top:0;pointer-events:none;opacity:0;`;
  document.body.appendChild(offscreenDiv);
  // Inner content div — the rasterization target, sized per-frame.
  // Mirrors the preview's CSS context (.canvas-rect): position:relative, overflow:hidden,
  // box-sizing:border-box so layout matches what the user sees in the preview panel.
  const offscreenContent = document.createElement('div');
  offscreenContent.style.cssText = `position:relative;margin:0;padding:0;box-sizing:border-box;overflow:hidden;background:#000;`;
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

  // Render video frame by frame
  for (let frameIdx = 0; frameIdx < totalFrames; frameIdx++) {
    if (abortSignal.aborted) break;

    const timelineTime = frameIdx * frameDuration;

    // Clear canvas to black
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, width, height);

    // Draw each visible clip in the same track stack order as preview.
    for (const clip of sortedRenderableClips) {
      const clipEnd = clip.startTime + clip.duration;
      if (timelineTime < clip.startTime || timelineTime >= clipEnd) {
        continue;
      }

      const mediaType = getMediaType(clip);
      if (mediaType === 'video') {
        const clipLocalTime = clip.trimStart + (timelineTime - clip.startTime);
        const video = videoElements.get(clip.id)!;

        await waitForSeek(video, clipLocalTime);

        const nw = video.videoWidth;
        const nh = video.videoHeight;
        const base = fitSize(nw, nh, width, height);
        const animTime = timelineTime - clip.startTime;
        const { x, y, scale, scaleX, scaleY, rotation } = getAnimatedTransform(clip, animTime);
        const scaledW = base.w * scale * scaleX;
        const scaledH = base.h * scale * scaleY;
        const drawX = (width - scaledW) / 2 + x * base.w;
        const drawY = (height - scaledH) / 2 + y * base.h;
        const mask = getAnimatedMask(clip, animTime);
        withTransformAndMask(ctx, drawX, drawY, scaledW, scaledH, rotation, mask, () => {
          ctx.drawImage(video, drawX, drawY, scaledW, scaledH);
        });
        continue;
      }

      if (mediaType === 'image') {
        const img = imageElements.get(clip.id)!;
        const nw = img.naturalWidth;
        const nh = img.naturalHeight;
        const base = fitSize(nw, nh, width, height);
        const animTime = timelineTime - clip.startTime;
        const { x, y, scale, scaleX, scaleY, rotation } = getAnimatedTransform(clip, animTime);
        const scaledW = base.w * scale * scaleX;
        const scaledH = base.h * scale * scaleY;
        const drawX = (width - scaledW) / 2 + x * base.w;
        const drawY = (height - scaledH) / 2 + y * base.h;
        const mask = getAnimatedMask(clip, animTime);
        withTransformAndMask(ctx, drawX, drawY, scaledW, scaledH, rotation, mask, () => {
          ctx.drawImage(img, drawX, drawY, scaledW, scaledH);
        });
        continue;
      }

      if (mediaType === 'component') {
        const entry = componentEntriesByClipId.get(clip.id);
        if (!entry) continue;
        const Component = entry.Component;

        const currentTime = timelineTime - clip.startTime;
        const progress = clip.duration > 0 ? currentTime / clip.duration : 0;
        const animTime = timelineTime - clip.startTime;
        const { x, y, scale, scaleX, scaleY, rotation } = getAnimatedTransform(clip, animTime);
        const scaledW = width * scale * scaleX;
        const scaledH = height * scale * scaleY;
        const drawX = (width - scaledW) / 2 + x * width;
        const drawY = (height - scaledH) / 2 + y * height;
        const mask = getAnimatedMask(clip, animTime);

        // Render the component DOM at a fixed logical size (matching the
        // preview's COMPONENT_LOGICAL_BASE) so that CSS pixel values (padding,
        // font-size, border, etc.) produce identical proportions in both preview
        // and export.  html-to-image upscales to export resolution via pixelRatio.
        const LOGICAL_BASE = 960;
        const aspect = width / height;
        const logicalW = LOGICAL_BASE * scale * scaleX;
        const logicalH = (LOGICAL_BASE / aspect) * scale * scaleY;
        const renderPixelRatio = scaledW / logicalW;

        const clipProps: ComponentClipProps = {
          currentTime,
          duration: clip.duration,
          width: logicalW,
          height: logicalH,
          progress,
        };
        // Capture current frame of any video media props as data-URL images
        const videoFrameUrls = new Map<string, string>();
        if (entry.propDefinitions && clip.componentProps) {
          for (const [key, def] of Object.entries(entry.propDefinitions)) {
            if (def.type !== 'media') continue;
            const path = clip.componentProps[key];
            if (!path) continue;
            const media = mediaByPath.get(path);
            if (media?.type !== 'video') continue;
            const video = mediaPropVideos.get(path);
            if (video) {
              videoFrameUrls.set(path, await captureVideoFrame(video, currentTime));
            }
          }
        }

        const resolvedProps = resolveComponentPropsForExport(
          clip.componentProps,
          entry.propDefinitions,
          clipProps,
          mediaByPath,
          componentEntriesByMediaPath,
          videoFrameUrls,
        );

        try {
          // Size the content container to the logical (CSS) dimensions
          offscreenContent.style.width = `${logicalW}px`;
          offscreenContent.style.height = `${logicalH}px`;

          // Match preview DOM structure: ComponentRenderer wraps in
          // <div style={{width:'100%',height:'100%'}}> <Component/> </div>
          flushSync(() => {
            offscreenRoot.render(
              React.createElement('div', { style: { width: '100%', height: '100%' } },
                React.createElement(Component, {
                  ...clipProps,
                  ...resolvedProps,
                }),
              ),
            );
          });

          // Wait for the browser to paint the rendered content
          await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));

          // Rasterize at logical size, upscaled to full export resolution via pixelRatio
          const rasterCanvas = await toCanvas(offscreenContent, {
            width: logicalW,
            height: logicalH,
            pixelRatio: renderPixelRatio,
            skipAutoScale: true,
          });
          withTransformAndMask(ctx, drawX, drawY, scaledW, scaledH, rotation, mask, () => {
            ctx.drawImage(rasterCanvas, drawX, drawY, scaledW, scaledH);
          });
        } catch (e) {
          console.warn(`Component rasterization failed for ${clip.mediaName}:`, e);
        }
      }
    }

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
  // These inherit the parent component clip's timeline position.
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

  // Clean up video/image elements, media-prop videos, and offscreen container
  for (const v of videoElements.values()) v.src = '';
  for (const v of mediaPropVideos.values()) v.src = '';
  for (const img of imageElements.values()) img.src = '';
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
