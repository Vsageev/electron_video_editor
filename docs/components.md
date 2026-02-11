# Component Clips

## Authoring

Standard React components (TSX/JSX). Only `react` and `react-dom` imports are allowed. Bundled with esbuild at import time into ESM, loaded at runtime via `import(blob:...)`.

## Runtime Props

Every component receives:

```ts
{ currentTime, duration, width, height, progress }
```

## Custom Props

Declared via a `propDefinitions` export:

```ts
export const propDefinitions = {
  title: { type: 'string', default: 'Hello', label: 'Title' },
  size:  { type: 'number', default: 48, min: 12, max: 200, label: 'Font Size' },
  color: { type: 'color',  default: '#ffffff', label: 'Text Color' },
  show:  { type: 'boolean', default: true, label: 'Visible' },
  align: { type: 'enum', default: 'center', options: ['left','center','right'], label: 'Alignment' },
  bg:    { type: 'media', default: '', label: 'Background Media' },
};
```

Supported types: `string`, `number`, `color`, `boolean`, `enum`, `media`. Edited in the properties sidebar with type-appropriate controls.

## Media Prop Nesting

A `media` prop referencing another component renders it as a child with its own editable props (one level deep). Video/image references render as `<video>`/`<img>` elements. Audio resolves to `null`.

## Built-in Components

ColorBackground, TextOverlay, Animation, CountdownTimer — available from the import dropdown without a file.

## Safety

- No `eval` / `new Function` (blocked by Electron CSP).
- Error boundary catches crashes and displays the error message.
- Loading state shown while the bundle initializes.
