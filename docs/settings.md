# Settings

## API Keys

Accessed via the gear icon in the titlebar.

- Default slots: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `ELEVEN_LABS_API_KEY`.
- Add/remove custom keys.
- Values are password-masked and stored locally.

## Global Error Handling

- Renderer-level global handlers are registered in `src/main.tsx` for `window.error` and `window.unhandledrejection`.
- React root render failures are caught by a root-level error boundary in `src/main.tsx`.
- Renderer global failures are surfaced via `projectError` store state and shown in the top banner, with detailed error text (message/stack/cause where available).
- Main process global handlers in `main.js` catch `uncaughtException`, `unhandledRejection`, renderer crashes (`render-process-gone`), and unresponsive renderer events.
- Renderer-process crashes trigger a bounded auto-reload attempt in `main.js` to recover without requiring a full app restart.
