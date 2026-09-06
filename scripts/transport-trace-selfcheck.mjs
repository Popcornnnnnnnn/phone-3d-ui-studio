// Real loopback WebSocket/HTTP integration, not physical Wi-Fi performance.
import assert from 'node:assert/strict'
import net from 'node:net'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { WebSocket } from 'ws'

async function unusedPort() {
  const socket = net.createServer()
  await new Promise((resolve, reject) => { socket.once('error', reject); socket.listen(0, '127.0.0.1', resolve) })
  const port = socket.address().port
  await new Promise((resolve) => socket.close(resolve))
  return port
}
const port = await unusedPort()
const framePort = await unusedPort()
assert.notEqual(port, framePort)
const child = spawn(process.execPath, ['scripts/live-bridge.mjs'], {
  cwd: new URL('..', import.meta.url),
  env: { ...process.env, PHONE_BRIDGE_HOST: '127.0.0.1', PHONE_BRIDGE_PORT: String(port), PHONE_BRIDGE_FRAME_PORT: String(framePort) },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let output = ''
for (const stream of [child.stdout, child.stderr]) stream.on('data', (data) => { output = (output + data).slice(-8_000) })
let exited = false
child.once('exit', () => { exited = true })
let phone
try {
  let ready = false
  for (let attempt = 0; attempt < 30 && !exited; attempt += 1) {
    try { ready = (await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(300) })).ok } catch { /* startup only */ }
    if (ready) break
    await delay(50)
  }
  assert.ok(ready, output)
  const producerSessionId = randomUUID()
  phone = new WebSocket(`ws://127.0.0.1:${port}/?role=phone-pose&producerSessionId=${producerSessionId}&captureSource=screencapturekit-host`)
  await new Promise((resolve, reject) => { phone.once('open', resolve); phone.once('error', reject) })
  const ack = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('No trace delivery ACK')), 2_000)
    phone.on('message', (data) => {
      const message = JSON.parse(data.toString())
      if (message.type === 'frame-transport-trace-ack') { clearTimeout(timeout); resolve(message) }
    })
  })
  phone.send(JSON.stringify({ type: 'encoder-status', producerSessionId,
    captureSource: 'screencapturekit-host', captureState: 'streaming', timestampMs: Date.now(),
    frameTransportTraceVersion: 2, frameTransportTraceThroughRevision: 1,
    frameTransportTraceAcknowledgedRevision: 0, frameTransportTraceDiscardedThroughRevision: 0,
    frameTransportTraceExportGeneration: 7,
    frameTransportTraceSamples: [{ sequence: 1, revision: 1, frameId: 1, generation: 1,
      outcome: 'frame-ack-hard-timeout', timings: { unfinishedMs: 600 } }],
  }))
  assert.deepEqual(await ack, { type: 'frame-transport-trace-ack', producerSessionId, throughRevision: 1, exportGeneration: 7 })
  const trace = await (await fetch(`http://127.0.0.1:${port}/transport/trace`)).json()
  assert.equal(trace.records.length, 1)
  assert.equal(trace.records[0].outcome, 'frame-ack-hard-timeout')
  const diagnostics = await (await fetch(`http://127.0.0.1:${port}/diagnostics`)).json()
  assert.equal(diagnostics.encoderSamples.at(-1).frameTransportTraceSamples, undefined)
  console.log('PASS: exact session/generation ACK, failed-frame retention, isolated trace endpoint, ordinary heartbeat stripping')
} finally {
  phone?.terminate()
  if (!exited) child.kill('SIGTERM')
  for (let attempt = 0; attempt < 20 && !exited; attempt += 1) await delay(50)
  if (!exited) child.kill('SIGKILL')
}
