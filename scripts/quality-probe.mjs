import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const args = process.argv.slice(2)
const snapshotMode = args[0] === '--sample'
const motionMode = args[0] === '--motion'
const colorMode = args[0] === '--color'
const mode = snapshotMode ? ['--sample'] : motionMode ? ['--motion'] : []
const [input, output] = mode.length ? args.slice(1) : args
if (colorMode ? args.length !== 2 : !input || !output || args.length !== (mode.length ? 3 : 2)) {
  throw new Error('Usage: node scripts/quality-probe.mjs [--sample|--motion] INPUT_PNG_OR_SAMPLE_DIR NEW_OUTPUT_DIR; or --color NEW_OUTPUT_DIR')
}
const build = mkdtempSync(join(tmpdir(), 'phone3d-quality-build-'))
try {
  const binary = join(build, 'quality-probe')
  const compile = spawnSync('xcrun', ['swiftc', '-O', '-o', binary,
    'ios/Shared/H264Encoder.swift', 'ios/Shared/LiveProtocol.swift',
    'scripts/codec-quality-probe.swift'], { cwd: root, stdio: 'inherit', timeout: 60_000 })
  if (compile.error || compile.status !== 0) throw new Error(`Compile failed: ${compile.error ?? compile.status}`)
  const runArgs = colorMode ? ['--color', resolve(args[1])] : [...mode, resolve(input), resolve(output)]
  const run = spawnSync(binary, runArgs, { stdio: 'inherit', timeout: 60_000 })
  if (run.error || run.status !== 0) throw new Error(`Probe failed: ${run.error ?? run.status}`)
} finally {
  // The sole deletion target is the fresh mkdtemp build directory, never captures.
  rmSync(build, { recursive: true, force: true })
}
