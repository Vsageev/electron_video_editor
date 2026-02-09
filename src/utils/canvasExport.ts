import { Muxer, ArrayBufferTarget } from 'webm-muxer';
import type { TimelineClip } from '../types';
import { getAnimatedTransform, getAnimatedMask } from './keyframeEngine';

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

export async function exportToVideo(
  clips: TimelineClip[],
  width: number,
  height: number,
  fps: number,
  onProgress: (percent: number) => void,
  abortSignal: AbortSignal,
  bitrate: number = 8_000_000,
): Promise<Blob> {
  const videoClips = clips.filter((c) => c.type === 'video');
  if (videoClips.length === 0) {
    throw new Error('No video clips to export');
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
      const video = await loadVideo(`file://${clip.mediaPath}`);
      videoElements.set(clip.id, video);
    }),
  );

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

    // Draw each visible clip
    for (const clip of videoClips) {
      const clipEnd = clip.startTime + clip.duration;

      if (timelineTime >= clip.startTime && timelineTime < clipEnd) {
        const clipLocalTime = clip.trimStart + (timelineTime - clip.startTime);
        const video = videoElements.get(clip.id)!;

        await waitForSeek(video, clipLocalTime);

        const nw = video.videoWidth;
        const nh = video.videoHeight;
        const base = fitSize(nw, nh, width, height);
        const animTime = timelineTime - clip.startTime;
        const { x, y, scale, scaleX, scaleY } = getAnimatedTransform(clip, animTime);
        const scaledW = base.w * scale * scaleX;
        const scaledH = base.h * scale * scaleY;
        const drawX = (width - scaledW) / 2 + x * base.w;
        const drawY = (height - scaledH) / 2 + y * base.h;

        const mask = getAnimatedMask(clip, animTime);
        if (mask) {
          ctx.save();
          const mcx = drawX + mask.centerX * scaledW;
          const mcy = drawY + mask.centerY * scaledH;
          const mw = (mask.width / 2) * scaledW;
          const mh = (mask.height / 2) * scaledH;
          ctx.beginPath();
          if (mask.shape === 'ellipse') {
            ctx.ellipse(mcx, mcy, mw, mh, 0, 0, Math.PI * 2);
          } else {
            const rx = mask.borderRadius * Math.min(mw, mh) * 2;
            if (rx > 0) {
              const lx = mcx - mw, ly = mcy - mh, rw = mw * 2, rh = mh * 2;
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
            } else {
              ctx.rect(mcx - mw, mcy - mh, mw * 2, mh * 2);
            }
          }
          ctx.clip();
        }

        ctx.drawImage(video, drawX, drawY, scaledW, scaledH);

        if (mask) {
          ctx.restore();
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

  // Render audio offline
  if (hasAudio) {
    try {
      await renderAudio(videoClips, totalDuration, muxer);
    } catch (e) {
      console.warn('Audio encoding failed, exporting without audio:', e);
    }
  }

  muxer.finalize();
  videoEncoder.close();

  // Clean up video elements
  for (const v of videoElements.values()) v.src = '';

  onProgress(100);

  const { buffer } = target;
  return new Blob([buffer], { type: 'video/webm' });
}

async function renderAudio(
  videoClips: TimelineClip[],
  totalDuration: number,
  muxer: Muxer<ArrayBufferTarget>,
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

  for (const clip of videoClips) {
    try {
      const fileBuffer = await window.api.readFile(clip.mediaPath);
      const audioBuffer = await offlineCtx.decodeAudioData(fileBuffer.slice(0));

      const source = offlineCtx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(offlineCtx.destination);

      // Start the source at the clip's timeline position, offset by trimStart
      const offset = clip.trimStart;
      const duration = clip.duration;
      source.start(clip.startTime, offset, duration);
    } catch (e) {
      console.warn(`Could not decode audio for ${clip.mediaName}:`, e);
    }
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
