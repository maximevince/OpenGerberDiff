import { defineConfig } from 'vitest/config';

// Unit tests live under src/. The e2e/ folder is Playwright-only and must not be
// collected by Vitest.
export default defineConfig({
  test: {
    include: ['src/**/*.{test,spec}.ts'],
    exclude: ['e2e/**', 'node_modules/**'],
    environment: 'node',
  },
});
