/**
 * electron-builder's hook, to put the right SQLite binary in the package.
 *
 * Packaging is where the architecture stops being "this machine": the mac job
 * builds an Intel slice on an Apple Silicon runner, and shipping that slice
 * the wrong binary makes the app die on launch for everyone on an Intel Mac.
 * electron-builder knows which arch it is about to write, so it is the only
 * thing in a position to ask for the matching one.
 *
 * Returning false tells electron-builder not to rebuild dependencies itself.
 * It would try to compile this one from source, which needs a C++ toolchain on
 * every runner — the published prebuilds are exactly what that would produce.
 */

import { execFileSync } from 'node:child_process'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

/** electron-builder hands over either the name or its Arch enum ordinal */
const ARCHES = ['ia32', 'x64', 'armv7l', 'arm64', 'universal']

function nameOf(arch) {
  if (typeof arch === 'number') return ARCHES[arch] ?? process.arch
  return arch || process.arch
}

export default async function beforeBuild(context) {
  // A universal mac build is assembled from the two single-arch builds, each
  // of which comes through here on its own, so there is nothing to choose.
  const arch = nameOf(context?.arch)
  if (arch === 'universal') return false

  execFileSync(process.execPath, [path.join(root, 'scripts', 'native.mjs'), 'electron', arch], {
    cwd: root,
    stdio: 'inherit'
  })

  return false
}
