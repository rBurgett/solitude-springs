import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// Multi-page build: the game (index.html) plus the look-dev lab pages under lab/.
// base './' keeps the production bundle relocatable (file:// or any sub-path).
export default defineConfig({
  base: './',
  server: {
    port: 5173,
    strictPort: false,
    headers: {
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    },
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 2500,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        lab: resolve(__dirname, 'lab/index.html'),
        characters: resolve(__dirname, 'lab/characters.html'),
        vignette: resolve(__dirname, 'lab/vignette.html'),
      },
    },
  },
});
