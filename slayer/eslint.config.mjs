/*
  ESLint for the terminal (npm run lint, or npx eslint <files>), its own flat config so the search for one stops here.
  Without it ESLint walked up to the repository root's eslint.config.mjs (the app-builder template's), whose plugins are
  installed nowhere, and failed before linting a file — in every git worktree of the repository.

  The plugins are this package's devDependencies. A git worktree under .claude/worktrees/ often has no node_modules of
  its own (or a link to the main checkout's), so each plugin is looked for here first, then in the main checkout's
  slayer/ (found from git's common directory), then in ESLINT_PLUGIN_DIR if that is set (a folder holding a
  node_modules with them).
*/

import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Where the plugins may be installed, nearest first */
function pluginHomes() {
  const homes = [HERE];
  try {
    const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: HERE, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (common) homes.push(join(dirname(common), 'slayer'));
  } catch {
    /* not a git checkout (an unpacked copy): this folder only */
  }
  if (process.env.ESLINT_PLUGIN_DIR) homes.push(resolve(process.env.ESLINT_PLUGIN_DIR));
  return [...new Set(homes)];
}

const HOMES = pluginHomes();
async function plugin(name) {
  for (const home of HOMES) {
    try {
      const file = createRequire(join(home, 'package.json')).resolve(name);
      const mod = await import(pathToFileURL(file).href);
      return mod.default ?? mod;
    } catch {
      /* not installed there: the next place */
    }
  }
  throw new Error(`eslint.config.mjs: ${name} is not installed in ${HOMES.join(', ')} — run npm install in slayer/`);
}

const js = await plugin('@eslint/js');
const tseslint = await plugin('typescript-eslint');
const reactHooks = await plugin('eslint-plugin-react-hooks');
const globals = await plugin('globals');

export default [
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'graphify-out/**',
      'coverage/**',
      '.cache/**',
      '.vercel/**',
      'public/**',
      'research/**',
      'engine/**',
      'theta/run/**',
      'src/data/generated/**',
      '**/*.d.mts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx,js,jsx,mjs,cjs}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: { 'react-hooks': reactHooks },
    linterOptions: { reportUnusedDisableDirectives: 'warn' },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      '@typescript-eslint/no-explicit-any': 'off',
      /* the codebase's own idioms, not faults: `void promise` for fire-and-forget, `while (true)` readers */
      'no-constant-condition': ['error', { checkLoops: false }],
    },
  },
];
