import type { ForgeConfig } from '@electron-forge/shared-types';
import { VitePlugin } from '@electron-forge/plugin-vite';

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    name: 'CourseFlow Dev',
    executableName: 'CourseFlow Dev',
    appBundleId: 'io.github.siruimei07.courseflow.dev'
  },
  makers: [],
  plugins: [
    new VitePlugin({
      build: [
        { entry: 'src/main.ts', config: 'vite.node.config.ts', target: 'main' },
        { entry: 'src/preload.ts', config: 'vite.node.config.ts', target: 'preload' },
        { entry: 'src/workspace.ts', config: 'vite.node.config.ts', target: 'main' }
      ],
      renderer: [{ name: 'main_window', config: 'vite.renderer.config.ts' }]
    })
  ]
};

export default config;
