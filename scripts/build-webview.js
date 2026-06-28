/**
 * Webview build. Two outputs into `media/dist/`:
 *   1. `app.js` — the chat module graph (ESM, loaded as <script type="module">). esbuild resolves
 *      `.js` import specifiers to their `.ts` sources, so the graph migrates `.js`→`.ts` freely.
 *   2. one IIFE file per classic script / standalone-panel webview (each loaded as a plain <script>
 *      that sets `window.*` or self-runs): i18n, spell, models, modelsFormat, voices, compare,
 *      dictionary, engines.
 * Vendored libs (mermaid.min.js, spell-engine.js) stay external and are not built here.
 * Type-checking is a separate gate: `tsc -p media/jsconfig.json`.
 */
const esbuild = require('esbuild');
const fs = require('fs');

// During the migration a source may be .ts (done) or .js (not yet) — esbuild handles either.
const src = (p) => (fs.existsSync(p.replace(/\.js$/, '.ts')) ? p.replace(/\.js$/, '.ts') : p);

const CLASSIC = ['i18n', 'spell', 'models', 'modelsFormat', 'voices', 'compare', 'dictionary', 'engines'];

async function build() {
  await esbuild.build({
    entryPoints: [src('media/app/main.js')],
    outfile: 'media/dist/app.js',
    bundle: true, format: 'esm', target: 'es2020', sourcemap: true, logLevel: 'warning',
  });
  await esbuild.build({
    entryPoints: Object.fromEntries(CLASSIC.map((n) => [n, src(`media/${n}.js`)])),
    outdir: 'media/dist',
    bundle: true, format: 'iife', target: 'es2020', sourcemap: true, logLevel: 'warning',
  });
}

build().catch(() => process.exit(1));
