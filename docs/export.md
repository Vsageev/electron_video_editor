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
2. Render each frame to an offscreen canvas (video → image → component layer order).
3. Apply per-clip transforms and masks.
4. Encode frames with VideoEncoder (VP9).
5. Mix and encode audio offline with AudioEncoder (Opus).
6. Mux streams with webm-muxer.
7. Save to a user-selected file.

Progress bar with cancel support. Components are rasterized via `html-to-image`.
