import { defineConfig } from 'vite';

/**
 * GAME_BASE sets the public sub-path, e.g. GAME_BASE=/gta-cali-claude/ for https://devhack.co/gta-cali-claude/.
 */
export default defineConfig({
  base: process.env.GAME_BASE ?? '/',
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
