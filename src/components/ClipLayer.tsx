import { useRef, useEffect, useCallback, useState, useMemo, memo, Component } from 'react';
import { filePathToFileUrl } from '../utils/fileUrl';
import { loadComponent } from '../utils/componentLoader';
import type { TimelineClip, MediaFile, ComponentClipProps } from '../types';

// ---------------------------------------------------------------------------
// ErrorBoundary for user components
// ---------------------------------------------------------------------------

interface ErrorBoundaryProps {
  children: React.ReactNode;
  clipId: number;
}

interface ErrorBoundaryState {
  error: string | null;
}

class ComponentErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error: error.message || 'Component crashed' };
  }

  componentDidCatch(error: Error) {
    console.error(`Component clip ${this.props.clipId} crashed:`, error);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          width: '100%', height: '100%',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(255,0,0,0.15)', color: '#ff6b6b',
          fontSize: 12, padding: 8, textAlign: 'center',
        }}>
          Component error: {this.state.error}
        </div>
      );
    }
    return this.props.children;
  }
}

// ---------------------------------------------------------------------------
// VideoRenderer — existing VideoLayer logic
// ---------------------------------------------------------------------------

const VideoRenderer = memo(function VideoRenderer({
  clip,
  globalTime,
  isPlaying,
  onSelect,
}: {
  clip: TimelineClip;
  globalTime: number;
  isPlaying: boolean;
  onSelect: (id: number) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const localTime = globalTime - clip.startTime + clip.trimStart;
  const src = useMemo(() => filePathToFileUrl(clip.mediaPath), [clip.mediaPath]);

  const handleMetadata = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Math.max(0, localTime);
    if (isPlaying) v.play().catch(() => {});
  }, [localTime, isPlaying]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v || v.readyState < 1) return;
    if (isPlaying) v.play().catch(() => {});
    else v.pause();
  }, [isPlaying]);

  useEffect(() => {
    if (isPlaying) return;
    const v = videoRef.current;
    if (!v || v.readyState < 1) return;
    const target = Math.max(0, localTime);
    if (Math.abs(v.currentTime - target) > 0.04) {
      v.currentTime = target;
    }
  }, [localTime, isPlaying]);

  const handleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect(clip.id);
  }, [clip.id, onSelect]);

  return (
    <video
      ref={videoRef}
      src={src}
      style={{ width: '100%', height: '100%', objectFit: 'contain', cursor: 'pointer' }}
      preload="auto"
      onLoadedMetadata={handleMetadata}
      onMouseDown={handleClick}
      playsInline
    />
  );
});

// ---------------------------------------------------------------------------
// ComponentRenderer — renders user-authored TSX component
// ---------------------------------------------------------------------------

const ComponentRenderer = memo(function ComponentRenderer({
  clip,
  mediaFile,
  globalTime,
  containerW,
  containerH,
  onSelect,
}: {
  clip: TimelineClip;
  mediaFile: MediaFile;
  globalTime: number;
  containerW: number;
  containerH: number;
  onSelect: (id: number) => void;
}) {
  const [UserComponent, setUserComponent] = useState<React.ComponentType<ComponentClipProps> | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!mediaFile.bundlePath) {
      setLoadError('No bundle path');
      return;
    }
    let cancelled = false;
    loadComponent(mediaFile.bundlePath)
      .then((entry) => { if (!cancelled) setUserComponent(() => entry.Component); })
      .catch((err) => { if (!cancelled) setLoadError(String(err)); });
    return () => { cancelled = true; };
  }, [mediaFile.bundlePath]);

  const handleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect(clip.id);
  }, [clip.id, onSelect]);

  if (loadError) {
    return (
      <div
        style={{
          width: '100%', height: '100%',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#ff6b6b', fontSize: 12,
        }}
        onMouseDown={handleClick}
      >
        {loadError}
      </div>
    );
  }

  if (!UserComponent) {
    return (
      <div style={{
        width: '100%', height: '100%',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#888', fontSize: 12,
      }}>
        Loading...
      </div>
    );
  }

  const currentTime = globalTime - clip.startTime;
  const progress = clip.duration > 0 ? currentTime / clip.duration : 0;

  return (
    <div style={{ width: '100%', height: '100%', cursor: 'pointer' }} onMouseDown={handleClick}>
      <ComponentErrorBoundary clipId={clip.id}>
        <UserComponent
          currentTime={currentTime}
          duration={clip.duration}
          width={containerW}
          height={containerH}
          progress={progress}
          {...(clip.componentProps || {})}
        />
      </ComponentErrorBoundary>
    </div>
  );
});

// ---------------------------------------------------------------------------
// AudioRenderer — placeholder for audio-only clips
// ---------------------------------------------------------------------------

const AudioRenderer = memo(function AudioRenderer({
  clip,
  onSelect,
}: {
  clip: TimelineClip;
  onSelect: (id: number) => void;
}) {
  const handleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect(clip.id);
  }, [clip.id, onSelect]);

  return (
    <div
      style={{
        width: '100%', height: '100%',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#888', fontSize: 12, cursor: 'pointer',
      }}
      onMouseDown={handleClick}
    >
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
        <rect x="9" y="3" width="6" height="10" rx="3" stroke="currentColor" strokeWidth="1.5" />
        <path d="M7 12a5 5 0 0010 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M12 17v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    </div>
  );
});

// ---------------------------------------------------------------------------
// ClipLayer — unified renderer: routes to Video/Component/Audio
// ---------------------------------------------------------------------------

export interface ClipLayerProps {
  clip: TimelineClip;
  mediaFile: MediaFile | undefined;
  globalTime: number;
  isPlaying: boolean;
  containerW: number;
  containerH: number;
  onNaturalSize: (id: number, w: number, h: number) => void;
  onSelect: (id: number) => void;
}

export default memo(function ClipLayer({
  clip,
  mediaFile,
  globalTime,
  isPlaying,
  containerW,
  containerH,
  onNaturalSize,
  onSelect,
}: ClipLayerProps) {
  const mediaType = mediaFile?.type ?? 'video';

  // For video clips, track natural size via a separate ref callback
  const videoWrapperRef = useRef<HTMLVideoElement | null>(null);

  const handleVideoMetadata = useCallback(() => {
    const v = videoWrapperRef.current;
    if (v) {
      onNaturalSize(clip.id, v.videoWidth, v.videoHeight);
    }
  }, [clip.id, onNaturalSize]);

  // For component/audio clips, report container size as natural size
  useEffect(() => {
    if (mediaType === 'component' || mediaType === 'audio') {
      onNaturalSize(clip.id, containerW, containerH);
    }
  }, [mediaType, clip.id, containerW, containerH, onNaturalSize]);

  if (mediaType === 'component') {
    return (
      <ComponentRenderer
        clip={clip}
        mediaFile={mediaFile!}
        globalTime={globalTime}
        containerW={containerW}
        containerH={containerH}
        onSelect={onSelect}
      />
    );
  }

  if (mediaType === 'audio') {
    return <AudioRenderer clip={clip} onSelect={onSelect} />;
  }

  // Default: video
  return (
    <VideoRenderer
      clip={clip}
      globalTime={globalTime}
      isPlaying={isPlaying}
      onSelect={onSelect}
    />
  );
});
