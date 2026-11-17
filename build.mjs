// Adapted from inheco_tec build.mjs (inheco-tec feature); promotion candidate, see design DD-1.
//
// Bundle the node package to CommonJS for the n8n runtime (design C16, DD-8).
//
// n8n loads community nodes with `require()`, while the sources and `n8n-node-core` are ESM
// and `n8n-node-core` is vendored (no npm package). esbuild therefore bundles every
// credential and node entry point into `dist/` as CommonJS, inlines `n8n-node-core` from its
// vendored TypeScript source in src/vendor/n8n-node-core/, and keeps `n8n-workflow` external
// (the n8n runtime provides it).
// Type checking is done separately by `tsc --noEmit` in the `build` script.
import { build } from 'esbuild';
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.join(here, 'src');
const distDir = path.join(here, 'dist');
const coreEntry = path.resolve(here, 'src/vendor/n8n-node-core/index.ts');

/** Every file under `src/` as a forward-slash path relative to `src/`. */
function sourceFiles() {
  return readdirSync(srcDir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    // `parentPath` is Node >= 20.12; `path` is its older (deprecated) name.
    .map((entry) => path.join(entry.parentPath ?? entry.path, entry.name))
    .map((full) => path.relative(srcDir, full).split(path.sep).join('/'));
}

const files = sourceFiles();
// Entry points follow the n8n naming convention; test files are never bundled.
const entryPoints = files
  .filter((f) => /^credentials\/[^/]+\.credentials\.ts$/.test(f) || /^nodes\/.+\.node\.ts$/.test(f))
  .map((f) => path.join(srcDir, f));

if (entryPoints.length === 0) {
  throw new Error('build.mjs: no credential or node entry points found under src/');
}
if (!existsSync(coreEntry)) {
  throw new Error(`build.mjs: n8n-node-core source not found at ${coreEntry}`);
}

rmSync(distDir, { recursive: true, force: true });

await build({
  entryPoints,
  outbase: srcDir,
  outdir: distDir,
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  external: ['n8n-workflow'],
  alias: { 'n8n-node-core': coreEntry },
  logLevel: 'info',
});

// Node icons (for example nodes/QInstrumentsBioShake/qinstrumentsBioShake.svg) sit next to the node file in dist/.
for (const f of files.filter((name) => name.endsWith('.svg'))) {
  const target = path.join(distDir, f);
  mkdirSync(path.dirname(target), { recursive: true });
  cpSync(path.join(srcDir, f), target);
}
