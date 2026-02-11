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
- **Keyframes**: Per-clip, per-property (`x`, `y`, `scale`) with easing. Engine in `keyframeEngine.ts`.
- **Overlap detection**: `hasOverlap()` helper prevents clips from overlapping on the same track.

## Common Pitfalls

- Prefer store-driven reactivity over imperative ref + callback patterns.
- Never use a single `<video>` element for multi-clip compositing — need one per visible clip.
- Guard against feedback loops between video `timeupdate` events and `currentTime` store sync.
- `hasSource` checks on video refs during render are fragile due to stale ref reads.
- `updateClip()` enforces no-overlap placement invariants for `track`/`startTime`/`duration`; use it for timeline placement changes rather than mutating clip arrays directly.
- IPC `deleteMediaFromProject(projectName, relativePath)` expects a project-relative path (e.g. `media/foo.mp4`), not an absolute path; convert via `projectDir` before calling. Component media may also have a `bundlePath` that should be deleted too.
- Removing a media file must also clean any `componentProps` values (for `type: 'media'` propDefinitions) that reference that media path; set them to `''` to keep project JSON references valid.
- `trackIdCounter` / `clipIdCounter` in `src/store/editorStore.ts` represent the max used id (new ids are `counter + 1`). If you add validation around counters, it must accept that semantics.
- Validation code must be defensive against malformed arrays (e.g. `mediaFiles` containing `null` entries) since projects can be edited externally; avoid `.map(x => x.prop)` without null checks.
- User-authored component loading must avoid `eval`/`new Function` (blocked by Electron CSP). Components are bundled as ESM and loaded via `import(blob:...)` in `src/utils/componentLoader.ts`, so `index.html` `script-src` must allow `blob:`.
- On Windows, Electron `dialog.showOpenDialog()` defaults to the first `filters` entry; put a combined "All Supported" filter first to avoid forcing users to switch the Explorer file-type dropdown.

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

**Sync rule**: `AGENTS.md` and `CLAUDE.md` must always be kept in sync. When you update one, apply the same changes to the other.
