import { defineConfig } from 'vite';
import { readDevelopmentBuildId } from './build/read-development-build-id';

export default defineConfig({
  build: {
    sourcemap: false,
    minify: false,
    rollupOptions: {
      external: ['electron']
    }
  },
  define: {
    __COURSEFLOW_APP_BUILD_ID__: JSON.stringify(readDevelopmentBuildId())
  }
});
