# Preview

## Compositing

One rendered element per visible clip, layered by track order (higher tracks on top). Video and image clips are fit-to-contain with aspect ratio preserved.

## Canvas

The preview canvas is a bordered rectangle sized to the export aspect ratio (e.g. 1920x1080), fit inside the preview wrapper with 32px padding. The canvas boundary is always visible — black `#000` interior against the `#0a0a0a` wrapper background, with a `rgba(255,255,255,0.12)` border.

### Canvas Zoom & Pan

Store state: `canvasZoom` (0.1–5), `canvasPanX`, `canvasPanY` in `editorStore.ts`.

Rendering: A `.canvas-zoom-layer` wrapper applies `translate(panX, panY) scale(zoom)` around a `.canvas-rect` div that holds all clip layers, handles, and standalone previews.

| Action | Input |
|--------|-------|
| Zoom (10–500 %) | `Ctrl/Cmd + Scroll` (zooms toward cursor) |
| Pan | Scroll (trackpad/wheel), middle-mouse drag, or `Space + drag` |
| Reset view | Click zoom badge (bottom-right corner) |

The zoom badge always shows the current zoom percentage. When zoomed/panned away from default, it highlights and clicking it calls `resetCanvasView()` to reset to 100% centered.

### Aspect Ratio Toolbar

A toolbar above the canvas shows a preset dropdown (16:9, 9:16, 1:1, 4:3, 4:5) and the current pixel dimensions. Changing the preset updates `exportSettings.width`/`exportSettings.height` which in turn re-computes the visible canvas size.

## Transform Handles

Select a clip to display interactive handles:

- **Corner handles** — uniform scale.
- **Edge handles** (N/S/E/W) — non-uniform scaleX/scaleY.
- **Drag body** — reposition (x, y).

All handles live inside `.canvas-rect` so they transform with the canvas zoom/pan.

## Standalone Preview

Clicking a media item in the sidebar with no timeline clips shows a quick inline preview inside the canvas rectangle.
