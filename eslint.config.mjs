// Flat ESLint config for the n8n-nodes-qinstruments-bioshake node. Self-contained so it lints
// under `npm run --workspaces --if-present lint` (<private-doc-ref>) with cwd = this package; the
// dev tooling is hoisted from the root npm workspace.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
);
