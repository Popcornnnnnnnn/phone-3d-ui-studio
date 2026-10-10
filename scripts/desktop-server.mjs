import { fork } from 'node:child_process'
import { createServer } from 'node:http'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { networkInterfaces } from 'node:os'
import { dirname, extname, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.glb': 'model/gltf-binary' }

export function pairingEndpoints(port, interfaces = networkInterfaces()) {
  return Object.entries(interfaces).flatMap(([name, entries]) =>
    (entries ?? []).filter((item) => !item.internal && item.family === 'IPv4' && !/^(utun|awdl|llw|bridge)/.test(name))
      .map((item) => {
        const url = `ws://${item.address}:${port}/`
        const link = new URL('phone3dstudio://pair')
        link.searchParams.set('bridge', url)
        return { name, url, pairingURL: link.href }
      }))
}

export function createDesktopWebServer(directory) {
  const publicRoot = resolve(directory)
  return createServer(async (request, response) => {
    const reject = (status) => { response.writeHead(status); response.end() }
    // The native window loads assets over loopback. Personal builds may include
    // the exact existing iPhone model; all other private asset paths stay blocked.
    if (request.method !== 'GET' && request.method !== 'HEAD') return reject(405)
    if (!/^127\.0\.0\.1:\d+$/.test(request.headers.host ?? '')) return reject(403)
    let pathname
    try { pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname) }
    catch { return reject(400) }
    if (pathname.includes('\0') || pathname.includes('\\')) return reject(404)
    if (pathname.split('/').includes('local-assets') && pathname !== '/local-assets/iphone-17/iphone-17-black.glb') return reject(404)
    const file = resolve(publicRoot, `.${pathname === '/' ? '/index.html' : pathname}`)
    if (!file.startsWith(publicRoot + sep)) return reject(404)
    try {
      const info = await stat(file)
      if (!info.isFile()) return reject(404)
      response.writeHead(200, { 'content-type': mime[extname(file)] ?? 'application/octet-stream', 'content-length': info.size, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
      if (request.method === 'HEAD') return response.end()
      createReadStream(file).on('error', () => response.destroy()).pipe(response)
    } catch { reject(404) }
  })
}

export function preferredBridgePort(value) {
  const port = Number(value)
  return Number.isInteger(port) && port >= 1 && port < 65_535 ? port : 0
}

export async function startDesktopRuntime(preferredPort = 0, directory = resolve(root, 'dist')) {
  await stat(resolve(directory, 'index.html'))
  const web = createDesktopWebServer(directory)
  let stopping = false
  let bridge
  let attemptedPreferred = false
  let portFallback = false
  const spawnBridge = (selectedPort) => {
    let fallbackPending = false
    const child = fork(resolve(root, 'scripts/live-bridge.mjs'), [], {
      cwd: root,
      // The frame listener always follows the bridge port. A collision on
      // either listener abandons this pair and starts a fresh process.
      env: { ...process.env, PHONE_BRIDGE_PORT: String(selectedPort), PHONE_BRIDGE_FRAME_PORT: '0', PHONE_BRIDGE_HOST: '::' },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    })
    bridge = child
    child.stdout.pipe(process.stderr)
    child.stderr.pipe(process.stderr)
    child.once('error', (error) => { if (!stopping) fail(error.message) })
    child.once('exit', (code, signal) => {
      if (stopping || bridge !== child) return
      if (fallbackPending) spawnBridge(0)
      else fail(`The local bridge stopped (${signal ?? code}). Reopen the workspace to try again.`)
    })
    child.once('message', (ready) => {
      if (stopping || bridge !== child) return
      if (ready?.type === 'bridge-error') {
        if (attemptedPreferred && !portFallback && /EADDRINUSE/.test(ready.message ?? '')) {
          portFallback = true
          fallbackPending = true
          return
        }
        fail(ready.message)
        return
      }
      if (ready?.type !== 'bridge-ready') return
      web.listen(0, '127.0.0.1', () => {
        if (stopping) return
        clearTimeout(deadline)
        const url = new URL(`http://127.0.0.1:${web.address().port}/`)
        url.searchParams.set('experience', 'marble')
        url.searchParams.set('bridge', `ws://127.0.0.1:${ready.bridgePort}`)
        process.stdout.write(JSON.stringify({ type: 'ready', webURL: url.href, bridgePort: ready.bridgePort, framePort: ready.framePort,
          bridgePid: bridge.pid,
          reusedPort: attemptedPreferred && !portFallback && ready.bridgePort === preferredPort,
          pairingChanged: attemptedPreferred && portFallback, endpoints: pairingEndpoints(ready.bridgePort) }) + '\n')
      })
    })
  }
  const stop = (code = 0) => {
    if (stopping) return
    stopping = true
    process.exitCode = code
    clearTimeout(deadline)
    web.close(); web.closeAllConnections()
    process.stdin.pause()
    bridge?.kill('SIGTERM')
    const force = setTimeout(() => { if (bridge?.exitCode === null) bridge.kill('SIGKILL') }, 2500)
    force.unref()
  }
  const fail = (message) => {
    process.stderr.write(`${message}\n`)
    process.stdout.write(JSON.stringify({ type: 'error', message }) + '\n')
    stop(1)
  }
  const deadline = setTimeout(() => fail('The local workspace did not start within 15 seconds.'), 15000)
  web.once('error', (error) => fail(error.message))
  preferredPort = preferredBridgePort(preferredPort)
  attemptedPreferred = preferredPort !== 0
  spawnBridge(preferredPort)
  // The native parent owns stdin. Its exit (including a crash) must not leave
  // a hidden helper or LAN listener running.
  process.stdin.resume()
  process.stdin.once('end', () => stop())
  process.on('SIGINT', () => stop())
  process.on('SIGTERM', () => stop())
  return { stop, get bridge() { return bridge }, web }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startDesktopRuntime(process.argv[2]).catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1 })
}
