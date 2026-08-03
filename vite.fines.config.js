import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));

/** Builds the homepage Liveline island into js/fines-chart/ for GitHub Pages. */
export default defineConfig({
  plugins: [react()],
  define: {
    'process.env.NODE_ENV': JSON.stringify('production')
  },
  build: {
    outDir: 'js/fines-chart',
    emptyOutDir: true,
    cssCodeSplit: false,
    lib: {
      entry: resolve(root, 'src/fines-chart/main.jsx'),
      name: 'RegAnchorFinesChart',
      // IIFE so file:// and GitHub Pages both work (ES modules fail on file://)
      formats: ['iife'],
      fileName: () => 'fines-chart.js'
    },
    rollupOptions: {
      output: {
        assetFileNames: 'fines-chart[extname]',
        inlineDynamicImports: true
      }
    }
  }
});
