import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: {
      entry: 'src/client/portal-widget/index.ts',
      name: 'NurturChat',
      fileName: 'portal-chat',
      formats: ['iife'],
    },
    outDir: 'dist/widget',
    emptyOutDir: true,
    cssCodeSplit: false,
  },
});
