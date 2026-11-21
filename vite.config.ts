import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 4173,
    strictPort: false,
  },
  preview: {
    port: 4173,
    strictPort: false,
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    outDir: 'dist',
  },
});
