import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8')) as { version: string };
const buildTime = new Date().toISOString().slice(0, 16).replace('T', ' ');

export default defineConfig({
  plugins: [react()],
  base: './',
  define: {
    'import.meta.env.VITE_PLUGIN_VERSION': JSON.stringify(pkg.version),
    'import.meta.env.VITE_PLUGIN_BUILD_TIME': JSON.stringify(buildTime),
  },
  server: { host: true, port: 5176, strictPort: true },
  build: { outDir: 'dist', assetsDir: 'assets' },
});
