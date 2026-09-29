import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    target: 'es2020',
    // inline the models and texture maps (src/assets/models) as data URLs so
    // the output is only .html/.js/.css + icons — see src/assets/models/index.js
    assetsInlineLimit: 8 * 1024 * 1024,
    chunkSizeWarningLimit: 4000,
  },
  server: {
    host: true,
  },
});
