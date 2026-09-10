import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node'
  },
  // The renderer is written with the automatic JSX runtime, as tsconfig.web
  // says. Without this the components compile to `React.createElement` here
  // and throw the moment one is rendered — which is not a thing about them.
  esbuild: {
    jsx: 'automatic'
  },
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared')
    }
  }
})
