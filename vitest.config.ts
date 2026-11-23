import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Security-rules suites need the Firestore emulator: run them with `npm run test:rules`.
    exclude: ['tests/rules/**', 'node_modules/**'],
    globals: false,
  },
});
