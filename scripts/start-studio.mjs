import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { networkInterfaces } from 'node:os'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const children = new Set()
let stopping = false

function stop(code = 0) {
  if (stopping) return
  stopping = true
  process.exitCode = code
  for (const child of children) child.kill('SIGTERM')
  const deadline = setTimeout(() => {
    for (const child of children) child.kill('SIGKILL')
  }, 3000)
  deadline.unref()
}

function port(name, fallback) {
  const value = process.env[name] ?? String(fallback)
  if (!/^\d+$/.test(value) || Number(value) < 1024 || Number(value) > 65535) {
    throw new Error(`${name} must be a port from 1024 to 65535.`)
  }
  return Number(value)
}

function available(port, host) {
  return new Promise((resolve, reject) => {
    const probe = createServer()
    probe.once('error', (error) => reject(new Error(
      `Cannot use ${host}:${port} (${error.code}). Stop your existing studio or choose different PHONE_STUDIO_PORT, PHONE_BRIDGE_PORT and PHONE_BRIDGE_FRAME_PORT values.`,
    )))
    probe.listen(port, host, () => probe.close(resolve))
  })
}

function launch(name, args, env) {
  const child = spawn(process.execPath, args, { cwd: root, env, stdio: 'inherit' })
  children.add(child)
  child.once('error', (error) => {
    console.error(`${name}: ${error.message}`)
    children.delete(child)
    stop(1)
  })
  child.once('exit', (code, signal) => {
    children.delete(child)
    if (!stopping) {
      console.error(`${name} exited (${signal ?? code}); stopping the studio.`)
      stop(code || 1)
    }
  })
}

async function ready(url) {
  const until = Date.now() + 15000
  while (!stopping && Date.now() < until) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000) })
      await response.body?.cancel()
      if (response.ok) return
    } catch { /* Child servers are still starting. */ }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  if (!stopping) throw new Error(`Startup timed out: ${url}`)
}

process.once('SIGINT', () => stop())
process.once('SIGTERM', () => stop())

try {
  if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Use Node.js 24 or newer, then run npm ci.')
  const web = port('PHONE_STUDIO_PORT', 4317)
  const bridge = port('PHONE_BRIDGE_PORT', 4319)
  const frames = port('PHONE_BRIDGE_FRAME_PORT', bridge + 1)
  if (new Set([web, bridge, frames]).size !== 3) throw new Error('Web, bridge and frame ports must be different.')
  const host = process.env.PHONE_BRIDGE_HOST ?? '::'
  await Promise.all([available(web, '127.0.0.1'), available(bridge, host), available(frames, host)])
  if (!stopping) {
    const env = { ...process.env, PHONE_BRIDGE_PORT: String(bridge), PHONE_BRIDGE_FRAME_PORT: String(frames) }
    launch('Bridge', ['scripts/live-bridge.mjs'], env)
    launch('Web', ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(web), '--strictPort'], env)
    await Promise.all([ready(`http://127.0.0.1:${bridge}/health`), ready(`http://127.0.0.1:${web}/`)])
    if (!stopping) {
      const url = new URL(`http://127.0.0.1:${web}/`)
      url.searchParams.set('experience', 'marble')
      url.searchParams.set('bridge', `ws://127.0.0.1:${bridge}`)
      console.log(`\nStudio ready: ${url}`)
      console.log('iPhone LiveBridgeURL candidates (choose the Mac address on the same Wi-Fi):')
      for (const address of Object.values(networkInterfaces()).flat()) {
        if (address && !address.internal && address.family === 'IPv4') console.log(`  ws://${address.address}:${bridge}/?role=phone`)
      }
      console.log('iPhone installation/configuration: docs/QUICKSTART.zh-CN.md\nCtrl+C stops both servers. This command does not install the iPhone app.\n')
    }
  }
} catch (error) {
  console.error(error.message)
  stop(1)
}
