import { defineConfig } from 'vitest/config';

// Lightweight: pure-logic unit tests (store reducers, helpers). No DOM/jsdom needed.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts'],
  },
});
