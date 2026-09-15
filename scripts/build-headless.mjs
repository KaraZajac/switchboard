#!/usr/bin/env node
/**
 * Bundle the headless Switchboard into one file Node can run.
 *
 * Not electron-vite, because there is no Electron here and nothing to package
 * — the point of this build is a plain Node program you can drop on a server
 * beside a systemd unit. esbuild is already in the tree via vite, so this
 * costs nothing to keep.
 */
import { build } from 'esbuild'
import { readFileSync, writeFileSync, chmodSync, mkdirSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
const out = resolve(root, 'out-headless/switchboard-headless.cjs')

/*
 * What stays outside the bundle.
 *
 * The two native ones have to: a .node file is loaded by the runtime, not
 * inlined by a bundler. Electron and electron-updater are external for the
 * opposite reason — nothing here should ever reach them, and leaving them
 * external means that if anything ever does it fails loudly at that call
 * rather than dragging a desktop framework onto a server.
 */
const external = [
  'better-sqlite3-multiple-ciphers',
  '@number0/iroh',
  'electron',
  'electron-updater'
]

mkdirSync(dirname(out), { recursive: true })

const result = await build({
  entryPoints: [resolve(root, 'src/main/headless.ts')],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile: out,
  external,
  sourcemap: true,
  // Nothing reads the bundle; keeping names makes a stack trace from a server
  // worth reading.
  minify: false,
  keepNames: true,
  define: {
    'process.env.SWITCHBOARD_VERSION': JSON.stringify(pkg.version)
  },
  alias: { '@shared': resolve(root, 'src/shared') },
  banner: { js: '#!/usr/bin/env node' },
  logLevel: 'info',
  metafile: true
})

chmodSync(out, 0o755)

const bytes = Object.values(result.metafile.outputs).find((o) => o.entryPoint)?.bytes ?? 0
console.log('')
console.log(`  ${out}  ${(bytes / 1024).toFixed(0)} KB`)
console.log(`  External: ${external.join(', ')}`)
console.log('')

/*
 * A bundle that quietly pulled Electron in would run on a developer's laptop
 * and die on the server it was built for. Cheaper to notice here.
 */
const code = readFileSync(out, 'utf8')
for (const forbidden of ['electron', 'electron-updater']) {
  const pattern = new RegExp(`require\\(["']${forbidden}["']\\)`, 'g')
  for (const match of code.matchAll(pattern)) {
    const before = code.slice(Math.max(0, match.index - 300), match.index)
    const lazy = /await import\(|Promise\.resolve\(\)\.then|__toESM/.test(before)
    if (!lazy) {
      console.error(`  ${forbidden} is required at load time. Headless cannot start.`)
      process.exit(1)
    }
  }
}
writeFileSync(resolve(root, 'out-headless/meta.json'), JSON.stringify(result.metafile))
