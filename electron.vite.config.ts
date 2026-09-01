import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    // externalizeDepsPlugin auto-externalizes `dependencies` but NOT
    // `optionalDependencies`. Native optional deps (node-pty, serialport) MUST
    // stay external: bundling relocates their prebuilt .node files, and their
    // node-gyp-build loader then cannot find the binary at runtime, so the
    // dynamic import throws and the feature silently reports itself unavailable.
    // pdf2json is an optional (pure-JS) dep too, lazy-imported by the datasheet
    // PDF adapter; externalize it so rollup keeps the dynamic import intact
    // rather than trying to bundle a type:"module" package into the CJS main.
    plugins: [externalizeDepsPlugin({ include: ['@homebridge/node-pty-prebuilt-multiarch', 'serialport', 'pdf2json'] })],
    build: {
      rollupOptions: {
        external: ['@homebridge/node-pty-prebuilt-multiarch', 'serialport', 'pdf2json'],
        input: { index: resolve('src/main/index.ts') }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve('src/preload/index.ts') }
      }
    }
  },
  renderer: {
    root: 'src/renderer',
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared')
      }
    },
    plugins: [react()],
    build: {
      rollupOptions: {
        input: { index: resolve('src/renderer/index.html') }
      }
    }
  }
})
