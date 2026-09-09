#!/usr/bin/env node
/**
 * Put the right SQLite binary in place.
 *
 * The encrypted database is a compiled addon, and it is compiled against one
 * runtime at a time: Electron 33 and the Node that runs the tests have
 * different ABIs, and the wrong one does not fail politely — it either refuses
 * to load or takes the process down with it.
 *
 * Rather than ask anyone to remember which is currently installed, every
 * script that needs one asks for it first: `pretest` wants the Node build,
 * `predev` wants the Electron one, and packaging asks through
 * `scripts/before-build.mjs`. Both are kept side by side after the first
 * fetch, so the swap is a file copy and needs no network and no compiler.
 *
 *     node scripts/native.mjs node
 *     node scripts/native.mjs electron [arch]
 *
 * The arch only matters when packaging for a machine other than this one — a
 * mac runner building the Intel slice, say — and electron-builder passes it
 * through `scripts/before-build.mjs`.
 */

import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const require = createRequire(import.meta.url)

const PACKAGE = 'better-sqlite3-multiple-ciphers'
const runtime = process.argv[2]
const arch = process.argv[3] || process.arch

if (runtime !== 'node' && runtime !== 'electron') {
  console.error('Usage: node scripts/native.mjs <node|electron>')
  process.exit(1)
}

const pkg = path.join(root, 'node_modules', PACKAGE)
const release = path.join(pkg, 'build', 'Release')
const live = path.join(release, 'better_sqlite3.node')
const stash = path.join(release, 'runtimes')
const kept = path.join(stash, `${runtime}-${arch}.node`)
const marker = path.join(release, '.runtime')

/**
 * Which build is in place, or null when we cannot tell.
 *
 * The marker is written by this script and is the only trustworthy answer.
 * A binary with no marker beside it came from `npm install` and could belong
 * to either runtime, so it is not worth a guess: getting it wrong means the
 * process dies at the first query, and refetching costs a copy out of
 * prebuild-install's cache.
 */
function inPlace() {
  try {
    return fs.readFileSync(marker, 'utf8').trim()
  } catch {
    return null
  }
}

/** Download the prebuilt addon for a runtime, and keep it under its own name */
function fetchInto(target) {
  const args = ['--tag-prefix=v', `--arch=${arch}`]
  if (runtime === 'electron') {
    const electron = require(path.join(root, 'node_modules', 'electron', 'package.json'))
    args.push('--runtime=electron', `--target=${electron.version}`)
  }

  console.log(`Fetching the ${runtime}/${arch} build of ${PACKAGE}…`)
  execFileSync(path.join(root, 'node_modules', '.bin', 'prebuild-install'), args, {
    cwd: pkg,
    stdio: 'inherit'
  })

  // prebuild-install always unpacks to the live path; keep a copy under its own
  // name so the other runtime's does not overwrite it next time.
  fs.mkdirSync(stash, { recursive: true })
  fs.copyFileSync(live, target)
}

const wanted = `${runtime}-${arch}`

if (inPlace() === wanted && fs.existsSync(live)) {
  process.exit(0)
}

// From here the binary in place is about to stop matching the marker, so the
// marker goes first: a run that dies halfway leaves no claim behind.
fs.rmSync(marker, { force: true })

if (!fs.existsSync(kept)) fetchInto(kept)

fs.mkdirSync(release, { recursive: true })
fs.copyFileSync(kept, live)
fs.writeFileSync(marker, `${wanted}\n`)
console.log(`SQLite addon: the ${runtime}/${arch} build is in place.`)
