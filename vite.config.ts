import { defineConfig } from 'vite';

// Relative base so the build works on GitHub Pages or any sub-folder.
export default defineConfig({
  base: './',
  build: { chunkSizeWarningLimit: 2000 },
});
