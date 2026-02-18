import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'src-tauri', 'node_modules']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      // Allow unused vars prefixed with underscore
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_'
      }],
      // Allow any in test files - warn in source
      '@typescript-eslint/no-explicit-any': 'warn',
      // Allow fast refresh exports (common for context exports)
      'react-refresh/only-export-components': 'warn',
      // Allow setState in effects when necessary
      'react-hooks/set-state-in-effect': 'warn',
    },
  },
  // Components should use context hooks, not import directly from services/infrastructure.
  // Warn for now (some edge cases like Header.tsx need multi-account balance fetching).
  {
    files: ['src/components/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['warn', {
        patterns: [{
          group: [
            '**/services/database*',
            '**/services/wallet*',
            '**/services/sync*',
            '**/services/crypto*',
            '**/services/accounts*',
            '**/services/accountDiscovery*',
            '**/services/keyDerivation*',
            '**/services/brc100*',
            '**/services/sessionPasswordStore*',
            '**/services/tokens*',
            '**/services/messageBox*',
            '**/infrastructure/**',
          ],
          message: 'Components should use context hooks (useWallet, useSync, useAccounts, etc.) instead of importing from services/infrastructure directly. Use hooks or adapters for service access.',
        }],
      }],
    },
  },
  // Test files - more lenient
  {
    files: ['**/*.test.{ts,tsx}', '**/test/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
])
