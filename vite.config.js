import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  publicDir: 'public',
  build: {
    outDir: 'dist',
    target: 'es2020',
    cssCodeSplit: true,
    rollupOptions: {
      input: { landing: resolve(__dirname, 'index.html'), app: resolve(__dirname, 'app/index.html') },
    },
  },
});
