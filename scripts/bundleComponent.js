const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');

// esbuild plugin: block bare-specifier imports except react/react-dom.
//
// Note: We "shim" these deps so user components never bundle their own React.
const importRestrictionPlugin = {
  name: 'import-restriction',
  setup(build) {
    // Allow react, react-dom, react/jsx-runtime — resolve to shim
    build.onResolve({ filter: /^react(-dom)?(\/.*)?$/ }, (args) => {
      return { path: args.path, namespace: 'react-shim' };
    });

    // Provide shim content that reads from window.__EDITOR_REACT__
    build.onLoad({ filter: /.*/, namespace: 'react-shim' }, (args) => {
      if (args.path === 'react') {
        return {
          // Keep as CJS so esbuild can map both default and named imports.
          contents: `module.exports = window.__EDITOR_REACT__;`,
          loader: 'js',
        };
      }
      if (args.path === 'react/jsx-runtime' || args.path === 'react/jsx-dev-runtime') {
        // Provide a minimal JSX runtime backed by React.createElement so esbuild's
        // "automatic" JSX transform works without bundling React.
        return {
          contents: `
            const React = window.__EDITOR_REACT__;
            function jsx(type, props, key) {
              const p = props || {};
              if (key != null) p.key = key;
              return React.createElement(type, p);
            }
            module.exports = {
              Fragment: React.Fragment,
              jsx,
              jsxs: jsx,
              jsxDEV: jsx,
            };
          `,
          loader: 'js',
        };
      }
      if (args.path === 'react-dom' || args.path.startsWith('react-dom/')) {
        return {
          contents: `module.exports = window.__EDITOR_REACT_DOM__;`,
          loader: 'js',
        };
      }
      return { contents: `module.exports = window.__EDITOR_REACT__;`, loader: 'js' };
    });

    // Block all other bare-specifier imports (not relative/absolute paths)
    build.onResolve({ filter: /^[^./]/ }, (args) => {
      return {
        errors: [{
          text: `Import "${args.path}" is not allowed. Components may only import react, react-dom, and local files.`,
        }],
      };
    });
  },
};

/**
 * Bundle a TSX/JSX component into a single-file ESM module.
 * @param {string} sourcePath - Absolute path to the source file
 * @param {string} outFile - Absolute path for the output bundle
 * @returns {Promise<{ success: boolean, bundlePath?: string, error?: string }>}
 */
async function bundleComponent(sourcePath, outFile) {
  try {
    const outDir = path.dirname(outFile);
    await fs.promises.mkdir(outDir, { recursive: true });

    await esbuild.build({
      entryPoints: [sourcePath],
      bundle: true,
      format: 'esm',
      outfile: outFile,
      jsx: 'automatic',
      jsxImportSource: 'react',
      loader: { '.tsx': 'tsx', '.jsx': 'jsx', '.ts': 'ts', '.js': 'js' },
      plugins: [importRestrictionPlugin],
      write: true,
      logLevel: 'silent',
    });

    return { success: true, bundlePath: outFile };
  } catch (err) {
    return { success: false, error: err.message || String(err) };
  }
}

module.exports = { bundleComponent, importRestrictionPlugin };
