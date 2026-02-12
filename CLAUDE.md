# Editor Electron

Timeline-based video editor built with Electron + React 18 + TypeScript + Vite + Zustand.

## Architecture

- **Renderer**: DOM-based compositing (no HTML canvas). One `<video>` element per visible video clip, one React component per visible component clip.
- **Unified clip model**: `TimelineClip` has no `type` field — all clips (video, audio, component, image) are treated identically on the timeline. The render pipeline resolves type via `MediaFile.type` lookup.
- **Image clips**: Static images (PNG, JPG, GIF, WebP, SVG) are placed on the timeline with a default 5s duration. Rendered via `<img>` elements with natural-size-based fitting (like video). Full transform/keyframe/mask/export support.
- **Component clips**: TSX/JSX files are bundled at import time via esbuild (main process). User components receive `ComponentClipProps` (`currentTime`, `duration`, `width`, `height`, `progress`). Only `react`/`react-dom` imports allowed (enforced by esbuild plugin).
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
    PreviewPanel.tsx  – Preview (reactive, multi-clip compositing)
    ClipLayer.tsx     – Unified clip renderer (video/audio/component)
    PropertiesSidebar.tsx – Clip properties & keyframes
    MediaSidebar.tsx  – Imported media library
    ContextMenu.tsx   – Right-click menus
    ApiKeysModal.tsx  – API key management
  utils/
    canvasExport.ts   – WebM export pipeline
    keyframeEngine.ts – Keyframe interpolation
    formatTime.ts     – Time display helpers
    fileUrl.ts        – File path → URL conversion
    componentLoader.ts – Load/cache bundled user components
```

## Key Concepts

- **TimelineClip**: Core data model — holds media ref, track position, trim offsets, transform (`x`, `y`, `scale`), and optional keyframes. No `type` field — type is derived from `MediaFile`.
- **MediaFile**: Import-time metadata including `type` (`'video' | 'audio' | 'component' | 'image'`), and `bundlePath` for component clips.
- **ClipLayer**: Unified renderer that routes to `VideoRenderer`, `ImageRenderer`, `ComponentRenderer`, or `AudioRenderer` based on `MediaFile.type`.
- **PreviewPanel**: Renders a `ClipLayer` per visible clip at current playhead time. Standalone preview mode activates when clicking media in sidebar with no timeline clips.
- **ComponentClipProps**: Standard interface for user components: `{ currentTime, duration, width, height, progress }`.
- **Component propDefinitions**: Supported custom prop types are `string`, `number`, `color`, `boolean`, `enum` (`options: string[]`), and `media` (stores any media `path` string; empty string means none). When a `media` prop references a component, child props can be set via `componentProps['key:props']` and are passed through to the child component. Video/image media refs are rendered as `<video>`/`<img>` elements; audio refs resolve to `null`.
- **Global error handling**: Renderer-wide `window.error`/`window.unhandledrejection` listeners and a root React error boundary are registered in `src/main.tsx`; failures are surfaced through `projectError` with detailed message/stack text. Main-process handlers in `main.js` catch `uncaughtException`, `unhandledRejection`, renderer crash (`render-process-gone`), and unresponsive events, and perform bounded renderer auto-reload attempts after crashes.
- **Canvas zoom/pan**: The preview canvas is a visible bordered rectangle (`.canvas-rect`) sized to the export aspect ratio, wrapped in a `.canvas-zoom-layer` that applies CSS `translate + scale`. Store state: `canvasZoom`, `canvasPanX`, `canvasPanY`. Ctrl/Cmd+scroll zooms toward cursor; scroll pans; Space+drag or middle-click pans. Zoom badge resets view on click.
- **Keyframes**: Per-clip, per-property (`x`, `y`, `scale`) with easing. Engine in `keyframeEngine.ts`.
- **Overlap detection**: `hasOverlap()` helper prevents clips from overlapping on the same track.

## Common Pitfalls

- Prefer store-driven reactivity over imperative ref + callback patterns.
- Never use a single `<video>` element for multi-clip compositing — need one per visible clip.
- Guard against feedback loops between video `timeupdate` events and `currentTime` store sync.
- `hasSource` checks on video refs during render are fragile due to stale ref reads.
- Keep export compositing order aligned with preview (`tracks`-based stacking), not media-type buckets, or output layering will differ.
- Component clip export must resolve `propDefinitions` `media` props the same way preview does (video/image elements, component refs, `key:props` child props), otherwise component renders can fail during rasterization.
- `updateClip()` enforces no-overlap placement invariants for `track`/`startTime`/`duration`; use it for timeline placement changes rather than mutating clip arrays directly.
- IPC `deleteMediaFromProject(projectName, relativePath)` expects a project-relative path (e.g. `media/foo.mp4`), not an absolute path; convert via `projectDir` before calling. Component media may also have a `bundlePath` that should be deleted too.
- Removing a media file must also clean any `componentProps` values (for `type: 'media'` propDefinitions) that reference that media path; set them to `''` to keep project JSON references valid.
- `trackIdCounter` / `clipIdCounter` in `src/store/editorStore.ts` represent the max used id (new ids are `counter + 1`). If you add validation around counters, it must accept that semantics.
- Validation code must be defensive against malformed arrays (e.g. `mediaFiles` containing `null` entries) since projects can be edited externally; avoid `.map(x => x.prop)` without null checks.
- UI numeric formatting must be defensive for externally edited projects; never call `.toFixed()` on raw clip/keyframe fields without finite-number guards/fallbacks.
- Component `componentProps` media references must be normalized with project path conversions: store project-relative in `project.json`, resolve to absolute on load (including nested `key:props` media refs).
- Some Python installs expose `rembg` as a console script without `rembg.__main__`; avoid invoking background removal with `python -m rembg` and prefer calling `rembg.bg.remove` (or the `rembg` CLI binary) directly.
- User-authored component loading must avoid `eval`/`new Function` (blocked by Electron CSP). Components are bundled as ESM and loaded via `import(blob:...)` in `src/utils/componentLoader.ts`, so `index.html` `script-src` must allow `blob:`.
- On Windows, Electron `dialog.showOpenDialog()` defaults to the first `filters` entry; put a combined "All Supported" filter first to avoid forcing users to switch the Explorer file-type dropdown.
- Global runtime errors should flow through the existing `projectError` banner in renderer code; avoid adding separate one-off fatal error UIs unless the app cannot render at all.
- Handle all foreseeable runtime failures gracefully (safe fallbacks, guarded access, recoverable UI states) instead of throwing/crashing the renderer.
- **Long-running subprocess UX rule**: Any IPC call that spawns a child process (rembg, ffmpeg, transcription, etc.) must: (1) stream progress/stage events to the renderer via `webContents.send` so the UI can show what's happening, (2) display elapsed time in the UI so users know the operation hasn't hung, (3) provide a cancel mechanism (kill the child process via a separate IPC handler), and (4) handle the `cancelled` result gracefully (no error banner). Never leave the user staring at an indeterminate spinner with no way to cancel or verify the process is alive. Use `spawn` (not `execFile`) for long-running processes so stdout/stderr can be streamed.

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

**Feature documentation rule**: When you add or significantly change a feature, document it in the corresponding `docs/*.md` file (create one if none exists). Include what it does, relevant controls/inputs, store state involved, and key implementation details. Also add a concise entry to the **Key Concepts** section of this file if the feature introduces new architectural patterns.

**Git rule**: Never run `git checkout`, `git reset`, `git clean`, `git restore`, `git stash`, `git rebase`, or any other git commands that modify the working tree or history unless the user explicitly asks for that specific git command. Only use git for non-destructive reads (e.g. `git status`, `git diff`, `git log`) and commits/pushes when requested.

**Sync rule**: `AGENTS.md` and `CLAUDE.md` must always be kept in sync. When you update one, apply the same changes to the other.
