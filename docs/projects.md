# Projects

## Storage

Each project lives at `~/.claude/projects/<name>/` containing:

```
project.json   – timeline data, export settings, metadata
media/          – imported media files and component bundles
```

## Operations

- **Create / Open / Switch / Delete** from the project picker (click project name in titlebar).
- Last opened project auto-loads on startup.

## Persistence

- Auto-saved with a 2-second debounce.
- External edits to `project.json` are detected and reloaded.
- Paths stored as relative for portability, resolved to absolute at runtime.
