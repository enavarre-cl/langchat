/**
 * Webview build: bundles the chat module graph (entry `media/app/main`) into one ES module at
 * `media/dist/app.js`. esbuild resolves `.js` import specifiers to their `.ts` sources, so the graph
 * can migrate `.js`→`.ts` file-by-file without touching any import. Vendored libs (mermaid,
 * spell-engine) and the classic globals (zoom/i18n/spell) stay external `<script>` tags, not bundled.
 *
 * This is the BUILD only (transpile + bundle). Type-checking is a separate gate:
 * `tsc -p media/jsconfig.json`. The standalone panels (voices/models/compare/…) are their own webviews
 * and are not part of this bundle.
 */
const esbuild = require('esbuild');
const fs = require('fs');

// The entry may be .ts (migrated) or .js (not yet) — esbuild handles either.
const entry = fs.existsSync('media/app/main.ts') ? 'media/app/main.ts' : 'media/app/main.js';

esbuild
  .build({
    entryPoints: [entry],
    outfile: 'media/dist/app.js',
    bundle: true,
    format: 'esm',
    target: 'es2020',
    sourcemap: true,
    logLevel: 'warning',
  })
  .catch(() => process.exit(1));
