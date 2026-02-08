export function filePathToFileUrl(filePath: string): string {
  // Avoid broken `file://${path}` URLs when the path contains spaces, #, etc.
  // Works for macOS/Linux and Windows drive-letter paths.
  const p = filePath.replace(/\\/g, '/');
  const prefix = p.startsWith('/') ? 'file://' : 'file:///';
  return encodeURI(prefix + p);
}

