const fs = require('fs');
const path = require('path');

/**
 * Return built-in component entries from a directory.
 * @param {string} builtinDir
 * @returns {Promise<Array<{ name: string; fileName: string }>>}
 */
async function listBuiltinComponents(builtinDir) {
  try {
    const files = await fs.promises.readdir(builtinDir);
    return files
      .filter((f) => /\.(tsx|jsx)$/.test(f))
      .map((f) => ({
        name: path.basename(f, path.extname(f)),
        fileName: f,
      }));
  } catch {
    return [];
  }
}

/**
 * Copy a built-in component into the project media dir and bundle it.
 *
 * The bundler is injected for testability.
 *
 * @param {{
 *   builtinDir: string;
 *   projectsDir: string;
 *   projectName: string;
 *   fileName: string;
 *   bundleComponent: (sourcePath: string, outFile: string) => Promise<{ success: boolean; error?: string }>;
 * }} args
 * @returns {Promise<{ success: boolean; sourcePath?: string; bundlePath?: string; error?: string }>}
 */
async function addBuiltinComponent({ builtinDir, projectsDir, projectName, fileName, bundleComponent }) {
  try {
    const sourcePath = path.join(builtinDir, fileName);
    if (!fs.existsSync(sourcePath)) {
      return { success: false, error: `Built-in component not found: ${fileName}` };
    }

    // Copy source into project media dir
    const mediaDir = path.join(projectsDir, projectName, 'media');
    await fs.promises.mkdir(mediaDir, { recursive: true });
    const destPath = path.join(mediaDir, fileName);
    await fs.promises.copyFile(sourcePath, destPath);

    // Copy sidecar .md documentation if it exists
    const mdSource = sourcePath + '.md';
    if (fs.existsSync(mdSource)) {
      await fs.promises.copyFile(mdSource, destPath + '.md');
    }

    const sourceRelative = 'media/' + fileName;

    // Bundle it
    const baseName = path.basename(fileName, path.extname(fileName));
    const outFile = path.join(mediaDir, `${baseName}.component.js`);
    const result = await bundleComponent(sourcePath, outFile);
    if (!result.success) {
      // Clean up copied source on failure
      try { await fs.promises.unlink(destPath); } catch {}
      return result;
    }

    const bundleRelative = 'media/' + path.basename(outFile);
    return { success: true, sourcePath: sourceRelative, bundlePath: bundleRelative };
  } catch (err) {
    return { success: false, error: err.message || String(err) };
  }
}

module.exports = {
  listBuiltinComponents,
  addBuiltinComponent,
};

