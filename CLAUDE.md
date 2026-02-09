# Editor Electron

Timeline-based video editor built with Electron + React 18 + TypeScript + Vite + Zustand.

## Architecture

- **Renderer**: DOM-based compositing (no HTML canvas). One `<video>` element per visible clip.
- **State**: Single Zustand store (`src/store/editorStore.ts`) — all UI is store-driven, no imperative ref patterns.
- **Playback**: `requestAnimationFrame` clock drives the timeline; avoid `video.timeupdate` for sync.
- **Build**: Vite bundles the React app; `vite-plugin-electron` handles main/preload/renderer.

## Project Structure

```
main.js              – Electron main process
preload.js           – Electron preload (IPC bridge)
src/
  main.tsx           – React entry point
  types.ts           – Shared type definitions
  styles.css         – Global styles, CSS variables (dark theme)
  store/
    editorStore.ts   – Zustand store (media, clips, playback, UI state)
  components/
    App.tsx           – Root layout
    Timeline.tsx      – Track lanes and playhead
    TimelineClip.tsx  – Individual clip on timeline
    PreviewPanel.tsx  – Video preview (reactive, multi-clip compositing)
    PropertiesSidebar.tsx – Clip properties & keyframes
    MediaSidebar.tsx  – Imported media library
    ContextMenu.tsx   – Right-click menus
    ApiKeysModal.tsx  – API key management
  utils/
    canvasExport.ts   – WebM export pipeline
    keyframeEngine.ts – Keyframe interpolation
    formatTime.ts     – Time display helpers
    fileUrl.ts        – File path → URL conversion
```

## Key Concepts

- **TimelineClip**: Core data model — holds media ref, track position, trim offsets, transform (`x`, `y`, `scale`), and optional keyframes.
- **PreviewPanel**: Renders a `VideoLayer` per visible clip at current playhead time. Standalone preview mode activates when clicking media in sidebar with no timeline clips.
- **Keyframes**: Per-clip, per-property (`x`, `y`, `scale`) with easing. Engine in `keyframeEngine.ts`.
- **Overlap detection**: `hasOverlap()` helper prevents clips from overlapping on the same track.

## Common Pitfalls

- Prefer store-driven reactivity over imperative ref + callback patterns.
- Never use a single `<video>` element for multi-clip compositing — need one per visible clip.
- Guard against feedback loops between video `timeupdate` events and `currentTime` store sync.
- `hasSource` checks on video refs during render are fragile due to stale ref reads.

## Commands

```bash
npm run dev           # Vite dev server only
npm run dev:electron  # Full Electron app with hot reload
npm run build         # Production build
npm start             # Launch built Electron app
```

## Style

- TypeScript strict mode
- Functional React components with hooks
- Zustand for all shared state (no prop drilling)
- Dark theme via CSS custom properties

---

**Note to agents**: If during your work you discover new patterns, pitfalls, architectural decisions, or useful context about this codebase, update this file with your findings. Keep entries concise and organized under the appropriate section. This helps future agents (and humans) work more effectively.
