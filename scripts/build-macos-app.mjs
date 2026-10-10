import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const includeLocalModel = process.argv.includes('--with-local-model')
const localModel = 'local-assets/iphone-17/iphone-17-black.glb'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const build = join(root, 'build/macos')
const app = join(build, 'Phone 3D Studio.app')
const runtime = join(app, 'Contents/Resources/runtime')
const nodeVersion = 'v24.21.0'
const nodeSHA256 = 'bed7eea5325e1108f32ce5228ddd6a5f0f08a499ee42aa7442aea583702f6057'
const archive = `node-${nodeVersion}-darwin-arm64.tar.gz`
const run = (name, args, options = {}) => execFileSync(name, args, { cwd: root, stdio: 'inherit', ...options })

if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('This preview builds on an Apple Silicon Mac.')
if (includeLocalModel) await readFile(join(root, 'public', localModel))
await mkdir(build, { recursive: true })
try { await readFile(join(build, archive)) }
catch { run('/usr/bin/curl', ['--fail', '--location', '--max-time', '180', '--output', join(build, archive), `https://nodejs.org/dist/${nodeVersion}/${archive}`]) }
const bytes = await readFile(join(build, archive))
if (createHash('sha256').update(bytes).digest('hex') !== nodeSHA256) throw new Error(`Node archive checksum mismatch. Remove ${join(build, archive)} and rebuild.`)
run('/usr/bin/tar', ['-xzf', join(build, archive), '-C', build, `node-${nodeVersion}-darwin-arm64/bin/node`, `node-${nodeVersion}-darwin-arm64/LICENSE`])

run('npm', ['run', 'build'])
// This directory contains only this script's generated application.
await rm(app, { recursive: true, force: true })
run('/bin/bash', ['macos/build.sh', app])
await mkdir(runtime, { recursive: true })
await cp(join(build, `node-${nodeVersion}-darwin-arm64/bin/node`), join(runtime, 'node'))
await cp(join(root, 'dist'), join(runtime, 'dist'), {
  recursive: true,
  filter: (source) => !source.split('/').includes('local-assets'),
})
// Explicit personal build: copy only the existing licensed model, never the whole asset folder.
if (includeLocalModel) {
  await mkdir(join(runtime, 'dist/local-assets/iphone-17'), { recursive: true })
  await cp(join(root, 'public', localModel), join(runtime, 'dist', localModel))
  console.log('Included the local iPhone 17 model for personal use.')
}
await writeFile(join(runtime, 'package.json'), JSON.stringify({ private: true, type: 'module' }) + '\n')

// Copy the bridge's actual local module graph, rather than benchmark scripts,
// fixtures, recordings, source checkout or development dependencies.
const copied = new Set()
async function copyModule(relative) {
  const source = resolve(root, relative)
  if (copied.has(source)) return
  if (!source.startsWith(root + '/')) throw new Error(`Module outside project: ${source}`)
  copied.add(source)
  const content = await readFile(source, 'utf8')
  const destination = join(runtime, source.slice(root.length + 1))
  await mkdir(dirname(destination), { recursive: true })
  await writeFile(destination, content)
  for (const match of content.matchAll(/(?:from\s*|import\s*\(\s*|import\s*)['"](\.[^'"]+)['"]/g)) {
    await copyModule(resolve(dirname(source), match[1]).slice(root.length + 1))
  }
}
await copyModule('scripts/desktop-server.mjs')
await copyModule('scripts/live-bridge.mjs')
for (const name of ['ws', 'three', '@dimforge/rapier3d-compat']) {
  await cp(join(root, 'node_modules', name), join(runtime, 'node_modules', name), { recursive: true })
}
const notices = join(app, 'Contents/Resources/ThirdPartyLicenses')
await mkdir(notices, { recursive: true })
await cp(join(build, `node-${nodeVersion}-darwin-arm64/LICENSE`), join(notices, 'Node.txt'))
// Include licenses for both the bundled bridge dependencies and the Vite UI.
for (const name of ['ws', 'three', '@dimforge/rapier3d-compat', 'react', 'react-dom', '@react-three/fiber', '@react-three/drei']) {
  const directory = join(root, 'node_modules', name)
  const entries = await readdir(directory)
  for (const entry of entries.filter((value) => /^licen[sc]e/i.test(value))) {
    await cp(join(directory, entry), join(notices, `${name.replaceAll('/', '-')}-${entry}`))
  }
}
run('/usr/bin/codesign', ['--force', '--sign', '-', app])
run('/usr/bin/codesign', ['--verify', '--deep', '--strict', app])
console.log(`\nBuilt ${app}\nLocal ad-hoc build; external distribution still needs Developer ID signing and notarization.`)
