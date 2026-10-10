import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { request } from 'node:http'
import { createServer } from 'node:net'
import { spawn } from 'node:child_process'
import { createDesktopWebServer, pairingEndpoints, preferredBridgePort } from './desktop-server.mjs'

const cleanup = []
afterEach(async () => { while (cleanup.length) await cleanup.pop()() })
describe('desktop workspace assets', () => {
  it('serves the optional exact local model without exposing other private or outside files', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'phone3d-web-'))
    cleanup.push(() => rm(directory, { recursive: true, force: true }))
    await mkdir(join(directory, 'dist/local-assets'), { recursive: true })
    await writeFile(join(directory, 'secret.txt'), 'private')
    await writeFile(join(directory, 'dist/index.html'), '<main>Studio</main>')
    await writeFile(join(directory, 'dist/local-assets/phone.glb'), 'private-model')
    await writeFile(join(directory, 'dist/app.js'), 'export const ready=true')
    await mkdir(join(directory, 'dist/local-assets/iphone-17'), { recursive: true })
    await writeFile(join(directory, 'dist/local-assets/iphone-17/iphone-17-black.glb'), 'licensed-phone')
    const server = createDesktopWebServer(join(directory, 'dist'))
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    cleanup.push(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections() }))
    const base = `http://127.0.0.1:${server.address().port}`
    expect(await (await fetch(base)).text()).toContain('Studio')
    expect((await fetch(base + '/app.js')).headers.get('content-type')).toBe('text/javascript')
    expect((await fetch(base + '/app.js', { method: 'HEAD' })).status).toBe(200)
    expect((await fetch(base + '/local-assets/phone.glb')).status).toBe(404)
    const model = await fetch(base + '/local-assets/iphone-17/iphone-17-black.glb')
    expect(model.headers.get('content-type')).toBe('model/gltf-binary')
    expect(await model.text()).toBe('licensed-phone')
    expect((await fetch(base + '/local-assets/iphone-17/iphone-17-black.glb', { method: 'HEAD' })).status).toBe(200)
    expect((await fetch(base + '/%2e%2e%2fsecret.txt')).status).toBe(404)
    expect((await fetch(base + '/missing.js')).status).toBe(404)
    expect((await fetch(base, { method: 'POST' })).status).toBe(405)
    const hostile = await new Promise((resolve) => {
      request(base, { headers: { host: 'other.example' } }, (response) => { response.resume(); resolve(response.statusCode) }).end()
    })
    expect(hostile).toBe(403)
  })
  it('encodes connection links for actual LAN interfaces and omits tunnel/loopback addresses', () => {
    const interfaces = {
      en0: [{ family: 'IPv4', address: '192.168.1.8', internal: false }, { family: 'IPv6', address: 'fe80::1', internal: false }],
      lo0: [{ family: 'IPv4', address: '127.0.0.1', internal: true }],
      utun3: [{ family: 'IPv4', address: '198.18.0.1', internal: false }],
    }
    const endpoints = pairingEndpoints(4567, interfaces)
    expect(endpoints).toHaveLength(1)
    expect(new URL(endpoints[0].pairingURL).searchParams.get('bridge')).toBe('ws://192.168.1.8:4567/')
  })
})

describe('desktop bridge continuity', () => {
  const moduleURL = new URL('./desktop-server.mjs', import.meta.url).href
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  async function fixture() {
    const directory = await mkdtemp(join(tmpdir(), 'phone3d-runtime-'))
    cleanup.push(() => rm(directory, { recursive: true, force: true }))
    await writeFile(join(directory, 'index.html'), '<main>Studio</main>')
    await writeFile(join(directory, 'runner.mjs'), `import { startDesktopRuntime } from ${JSON.stringify(moduleURL)}; startDesktopRuntime(process.argv[2], process.argv[3]).catch((error) => { console.error(error); process.exitCode = 1 })`)
    return directory
  }
  async function freePort() {
    const probe = createServer()
    await new Promise((resolve) => probe.listen(0, '::', resolve))
    const port = probe.address().port
    await new Promise((resolve) => probe.close(resolve))
    return port < 65_535 ? port : freePort()
  }
  function launch(port, directory) {
    const child = spawn(process.execPath, [join(directory, 'runner.mjs'), String(port), directory], {
      cwd: join(import.meta.dirname, '..'), stdio: ['pipe', 'pipe', 'pipe'],
    })
    cleanup.push(async () => {
      if (child.exitCode === null) { child.stdin.end(); await pause(150); if (child.exitCode === null) child.kill('SIGKILL') }
    })
    const records = []
    let pending = ''
    let diagnostics = ''
    child.stderr.on('data', (data) => { diagnostics += data.toString() })
    child.stdout.on('data', (data) => {
      pending += data.toString()
      let end
      while ((end = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, end); pending = pending.slice(end + 1)
        try { records.push(JSON.parse(line)) } catch { /* bridge logs go to stderr */ }
      }
    })
    return { child, records, get diagnostics() { return diagnostics } }
  }
  async function message(runtime, type) {
    for (let attempt = 0; attempt < 300; attempt++) {
      const found = runtime.records.find((record) => record.type === type)
      if (found) return found
      if (runtime.child.exitCode !== null) throw new Error(`Desktop runtime exited before ${type}: ${runtime.diagnostics}`)
      await pause(50)
    }
    throw new Error(`Timed out waiting for ${type}: exit=${runtime.child.exitCode}, records=${JSON.stringify(runtime.records)}, stderr=${runtime.diagnostics}`)
  }

  it('reuses a free bridge and frame port, then releases them on exit', async () => {
    expect(preferredBridgePort('0')).toBe(0)
    expect(preferredBridgePort('65535')).toBe(0)
    const directory = await fixture()
    const port = await freePort()
    const runtime = launch(port, directory)
    const ready = await message(runtime, 'ready')
    expect(ready.bridgePort).toBe(port)
    expect(ready.framePort).toBe(port + 1)
    expect(ready.reusedPort).toBe(true)
    expect(ready.pairingChanged).toBe(false)
    runtime.child.stdin.end()
    for (let attempt = 0; attempt < 100 && runtime.child.exitCode === null; attempt++) await pause(50)
    expect(runtime.child.exitCode).toBe(0)
  }, 20000)

  it('leaves an occupied port alone, falls back, and reports later bridge loss', async () => {
    const directory = await fixture()
    const occupied = createServer()
    await new Promise((resolve) => occupied.listen(0, '::', resolve))
    cleanup.push(() => new Promise((resolve) => occupied.close(resolve)))
    const port = occupied.address().port
    const runtime = launch(port, directory)
    const ready = await message(runtime, 'ready')
    expect(ready.bridgePort).not.toBe(port)
    expect(ready.framePort).toBe(ready.bridgePort + 1)
    expect(ready.reusedPort).toBe(false)
    expect(ready.pairingChanged).toBe(true)
    expect(occupied.listening).toBe(true)
    process.kill(ready.bridgePid, 'SIGKILL')
    const error = await message(runtime, 'error')
    expect(error.message).toContain('local bridge stopped')
    for (let attempt = 0; attempt < 100 && runtime.child.exitCode === null; attempt++) await pause(50)
    expect(runtime.child.exitCode).toBe(1)
  }, 20000)

  it('falls back when only the adjacent frame port is occupied', async () => {
    const directory = await fixture()
    let port, occupied
    for (let attempt = 0; attempt < 20; attempt++) {
      port = await freePort()
      occupied = createServer()
      try {
        await new Promise((resolve, reject) => {
          occupied.once('error', reject)
          occupied.listen(port + 1, '::', resolve)
        })
        break
      } catch { occupied.close(); occupied = undefined }
    }
    if (!occupied) throw new Error('Could not reserve an adjacent frame port')
    cleanup.push(() => new Promise((resolve) => occupied.close(resolve)))
    const runtime = launch(port, directory)
    const ready = await message(runtime, 'ready')
    expect(ready.bridgePort).not.toBe(port)
    expect(ready.framePort).toBe(ready.bridgePort + 1)
    expect(ready.pairingChanged).toBe(true)
    expect(occupied.listening).toBe(true)
    runtime.child.stdin.end()
    for (let attempt = 0; attempt < 100 && runtime.child.exitCode === null; attempt++) await pause(50)
    expect(runtime.child.exitCode).toBe(0)
  }, 20000)
})
