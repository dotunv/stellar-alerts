import { defineConfig, globalIgnores } from 'eslint/config';
import noSecretLogging from '../../scripts/eslint-rules/no-secret-logging.js';

export default defineConfig([
  globalIgnores(['dist/**', 'coverage/**', 'generated/**', 'src/**/__tests__/**', 'src/**/*.test.ts']),
  {
    files: ['src/**/*.js', 'src/**/*.mjs', 'src/**/*.cjs', 'src/**/*.ts'],
    plugins: {
      'no-secret-logging': {
        rules: {
          'no-secret-logging': noSecretLogging,
        },
      },
    },
    rules: {
      'no-secret-logging/no-secret-logging': 'error',
    },
  },
]);
