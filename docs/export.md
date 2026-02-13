# Export

## Format

WebM (VP9 video + Opus audio).

## Settings

| Setting | Options |
|---------|---------|
| Resolution | 4K · 1080p · 720p · 480p |
| Frame rate | 24 · 30 · 60 fps |
| Bitrate | 4 · 8 · 16 · 32 Mbps |

## Pipeline

1. Load all video/image elements and bundle components.
2. Preload component `media` video props per clip+prop binding (`clipId:propKey`) so shared source files stay independently time-synced.
3. Render each frame to an offscreen canvas in timeline track stack order (same compositing order as preview), with component media time using `trimStart + localTime` like normal video clips.
4. For video-frame extraction, wait for the seeked frame to decode before rasterizing (via `requestVideoFrameCallback` when available) to reduce stale-frame jitter.
5. Apply per-clip transforms and masks.
6. Encode frames with VideoEncoder (VP9).
7. Mix and encode audio offline with AudioEncoder (Opus).
8. Mux streams with webm-muxer.
9. Save to a user-selected file.

Progress bar with cancel support. Components are rasterized via `html-to-image`.
