import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' so the built index.html works when loaded via file:// inside Electron
export default defineConfig({
  base: './',
  plugins: [react()],
  server: { port: 5190, strictPort: true },
  build: { outDir: 'dist' },
});
