import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import { readDevelopmentBuildId } from './build/read-development-build-id';

export default defineConfig({
  root: 'src/renderer',
  base: './',
  build: {
    outDir: resolve(__dirname, '.vite/renderer/main_window'),
    sourcemap: false,
    minify: false
  },
  define: {
    __COURSEFLOW_APP_BUILD_ID__: JSON.stringify(readDevelopmentBuildId())
  }
});
