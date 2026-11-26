// Integration check for the built, self-contained application. No real phone.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { access, readFile } from 'node:fs/promises'
import { createConnection } from 'node:net'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const runtime = join(root, 'build/macos/Phone 3D Studio.app/Contents/Resources/runtime')
const children = []
const localModel = 'local-assets/iphone-17/iphone-17-black.glb'
const includeLocalModel = process.argv.includes('--with-local-model')

async function bounded(promise, ms) {
  let timer
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Runtime check timed out')), ms) })]) }
  finally { clearTimeout(timer) }
}
async function start() {
  const environment = { ...process.env, PATH: '/usr/bin:/bin' }
  delete environment.NODE_OPTIONS
  const child = spawn(join(runtime, 'node'), [join(runtime, 'scripts/desktop-server.mjs')], {
    cwd: '/', env: environment, stdio: ['pipe', 'pipe', 'pipe'],
  })
  children.push(child)
  let buffer = '', errors = ''
  child.stderr.on('data', (data) => { errors = (errors + data).slice(-8000) })
  const ready = await bounded(new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code) => reject(new Error(`Runtime exited ${code}: ${errors}`)))
    child.stdout.on('data', (data) => {
      buffer += data
      let end
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1)
        try {
          const event = JSON.parse(line)
          if (event.type === 'ready') resolve(event)
          else if (event.type === 'error') reject(new Error(event.message))
        } catch (error) { reject(error) }
      }
    })
  }), 20000)
  return { child, ready }
}
function portClosed(port) {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host: '127.0.0.1' })
    socket.once('error', () => resolve(true))
    socket.once('connect', () => { socket.destroy(); resolve(false) })
  })
}
try {
  if (includeLocalModel) assert.deepEqual(await readFile(join(runtime, 'dist', localModel)), await readFile(join(root, 'public', localModel)))
  else await assert.rejects(access(join(runtime, 'dist/local-assets')))
  const first = await start(), second = await start()
  assert.notEqual(first.ready.bridgePort, second.ready.bridgePort)
  for (const { ready } of [first, second]) {
    assert.equal(ready.framePort, ready.bridgePort + 1)
    assert.equal((await fetch(ready.webURL)).status, 200)
    const model = await fetch(new URL(localModel, ready.webURL), { method: 'HEAD' })
    assert.equal(model.status, includeLocalModel ? 200 : 404)
    if (includeLocalModel) assert.equal(model.headers.get('content-type'), 'model/gltf-binary')
    assert.equal((await (await fetch(`http://127.0.0.1:${ready.bridgePort}/health`)).json()).ok, true)
    for (const endpoint of ready.endpoints) assert.equal(new URL(endpoint.pairingURL).searchParams.get('bridge'), endpoint.url)
  }
  const firstExit = once(first.child, 'exit')
  first.child.stdin.end()
  await bounded(firstExit, 5000)
  for (const port of [first.ready.bridgePort, first.ready.framePort, Number(new URL(first.ready.webURL).port)]) {
    assert.equal(await portClosed(port), true, `Owned port ${port} was left listening`)
  }
  assert.equal((await fetch(second.ready.webURL)).status, 200)
  const secondExit = once(second.child, 'exit')
  second.child.kill('SIGTERM')
  await bounded(secondExit, 5000)
  for (const port of [second.ready.bridgePort, second.ready.framePort, Number(new URL(second.ready.webURL).port)]) assert.equal(await portClosed(port), true)
  console.log('PASS: standalone bundled runtime; separate sessions; valid QR payloads; expected model packaging; EOF/SIGTERM close all owned ports; other session unaffected.')
} finally {
  await Promise.all(children.filter((child) => child.exitCode === null && child.signalCode === null).map(async (child) => {
    const exited = once(child, 'exit'); child.kill('SIGTERM')
    try { await bounded(exited, 4000) } catch { child.kill('SIGKILL') }
  }))
}
