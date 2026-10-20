const js = require('@eslint/js')
const n = require('eslint-plugin-n')
const prettier = require('eslint-config-prettier')
const globals = require('globals')

module.exports = [
  {
    // client and server are placeholders outside the workspace
    ignores: ['**/node_modules/**', 'client/**', 'server/**', 'cli/test/data/**', 'cli/reports/**', '**/coverage/**']
  },
  js.configs.recommended,
  n.configs['flat/recommended-script'],
  {
    files: ['**/*.js'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'commonjs', globals: globals.node },
    rules: {
      eqeqeq: ['error', 'always'],
      'no-console': 'warn',
      'no-unused-vars': ['warn', { args: 'none' }],
      'no-var': 'error',
      'prefer-const': 'error',
      // node:sqlite is the library database driver (Node 24), deliberately used while experimental
      'n/no-unsupported-features/node-builtins': ['error', { ignores: ['sqlite'] }],
      // the packages are private, devDependencies in tests and scripts are fine
      'n/no-unpublished-require': 'off',
      // the cli exits with a status on purpose, scripts start with a hashbang
      'n/no-process-exit': 'off',
      'n/hashbang': 'off'
    }
  },
  {
    // scripts, tests, and config loading (common has no logger) write to the console directly
    files: ['cli/scripts/**/*.js', 'cli/test/**/*.js', '**/*.spec.js', 'common/config/**/*.js'],
    rules: { 'no-console': 'off' }
  },
  {
    files: ['**/*.spec.js', 'cli/test/**/*.js'],
    // test/setup.js puts chai and sinon helpers on global
    languageOptions: {
      globals: { ...globals.mocha, expect: 'readonly', assert: 'readonly', should: 'readonly', sinon: 'readonly' }
    }
  },
  // formatting is left to prettier (pnpm format)
  prettier
]
