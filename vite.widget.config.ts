import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist/client/portal-widget',
    emptyOutDir: true,
    lib: {
      entry: path.resolve(__dirname, 'src/client/portal-widget/index.ts'),
      name: 'NurturChat',
      fileName: () => 'nurtur-chat.js',
      formats: ['iife'],
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
  resolve: {
    alias: {
      '@client': path.resolve(__dirname, 'src/client'),
      '@shared': path.resolve(__dirname, 'src/shared'),
    },
  },
});
