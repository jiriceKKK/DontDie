// ============================================================
// ESLint flat config. The application stays buildless, so lint is the only
// static gate besides `node --check`. Rules are intentionally behaviour-safe:
// they catch real defects (undeclared globals, unreachable code, accidental
// `innerHTML` on user data is covered by tests) without demanding a stylistic
// rewrite of 70 existing modules.
// ============================================================
import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    ignores: [
      'node_modules/**',
      'test-results/**',
      'playwright-report/**',
      'style.css',
      '.env*',
    ],
  },

  // ---- browser application code (native ES modules under js/) ------------
  {
    files: ['js/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        // Supabase UMD build attaches itself to window.supabase.
        supabase: 'readonly',
      },
    },
    rules: {
      ...js.configs.recommended.rules,
      // Legacy modules intentionally swallow storage/network errors in
      // `catch {}`; that is reviewed behaviour, not a defect to churn now.
      'no-empty': ['error', { allowEmptyCatch: true }],

      // TEMPORARY LEGACY ALLOWANCE (Phase 1).
      // These three rules find only pre-existing hygiene issues in the 70
      // modules that predate this baseline — unused imports, `let` that is
      // never reassigned, a redundant escape. None is a behaviour or security
      // defect, and fixing them here would mean touching files this phase has
      // no reason to change (Claude Execution Protocol #4). They are warnings
      // rather than errors so the build stays green, and `npm run lint` pins
      // `--max-warnings` to the exact count so no NEW occurrence can slip in.
      // Later phases clear them as they touch each module; when the count
      // reaches zero, promote all three back to 'error' and drop this note.
      'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_' }],
      'prefer-const': ['warn', { destructuring: 'all' }],
      'no-useless-escape': 'warn',
      'no-console': 'off',
      eqeqeq: ['error', 'smart'],
      'no-var': 'error',
      // Security-relevant: these must never appear in application code.
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-script-url': 'error',
    },
  },

  // ---- classic (non-module) bootstrap ------------------------------------
  // js/boot.js runs before the module graph, so it deliberately uses ES5-safe
  // syntax; `var` is correct there.
  {
    files: ['js/boot.js'],
    languageOptions: {
      ecmaVersion: 2018,
      sourceType: 'script',
      globals: { ...globals.browser },
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_' }],
      // The file is a verbatim move of the previously inline bootstrap. Keeping
      // it byte-for-byte identical (var and all) is what makes the move safe to
      // review; it is also the one script that must parse in the oldest engine
      // that reaches the page.
      'no-var': 'off',
      'prefer-const': 'off',
    },
  },

  // ---- service worker ----------------------------------------------------
  {
    files: ['sw.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: { ...globals.serviceworker, ...globals.browser },
    },
    rules: { ...js.configs.recommended.rules },
  },

  // ---- node tooling + tests ---------------------------------------------
  {
    files: ['scripts/**/*.mjs', 'tests/**/*.mjs', 'tests/**/*.js', 'playwright.config.js', 'eslint.config.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_' }],
      'no-console': 'off',
    },
  },

  // ---- E2E specs and browser fixtures ------------------------------------
  // Spec files are Node, but the bodies of page.evaluate() callbacks run in the
  // browser, so both global sets are legitimate here.
  {
    files: ['tests/e2e/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser },
    },
  },
];
