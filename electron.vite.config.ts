import { readFileSync } from 'fs'
import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const { version } = JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as { version: string }

/**
 * What the About page says, fixed when the bundle is made.
 *
 * The date is the build's, which for anything downloaded from a release is the
 * moment CI built that tag — the closest thing to "when did this version come
 * out" that the app can know about itself without asking the network.
 *
 * The licence is read from the file rather than copied into a string, so there
 * is one copy of it in the repository and the About page cannot drift from the
 * one that actually ships.
 */
const built = new Date().toISOString()
const licence = readFileSync(resolve('LICENSE'), 'utf8')

const about = {
  __APP_VERSION__: JSON.stringify(version),
  __BUILD_DATE__: JSON.stringify(built),
  __LICENSE__: JSON.stringify(licence)
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    /*
     * The version, put in at build time.
     *
     * `app.getVersion()` reads the packaged app's version, and returns
     * Electron's own when there is no package to read — so a build run from
     * source told everyone who asked that it was Switchboard 44.3.0, which is
     * the Electron it happens to be sitting on. The headless build already
     * takes its version this way.
     */
    define: about,
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    }
  },
  renderer: {
    // The About page is drawn here, so it needs the same three facts
    define: about,
    resolve: {
      alias: {
        '@shared': resolve('src/shared'),
        '@renderer': resolve('src/renderer')
      }
    },
    plugins: [tailwindcss(), react()]
  }
})
