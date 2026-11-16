import { defineConfig } from 'vite';

export default defineConfig({
  // 相對路徑：部署在網域根目錄或子路徑（GitHub Pages）都能運作。
  base: './',
  build: { chunkSizeWarningLimit: 700 },
});
