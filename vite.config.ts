import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    sourcemap: false,
    assetsInlineLimit: 4096,
    chunkSizeWarningLimit: 700,
  },
});
