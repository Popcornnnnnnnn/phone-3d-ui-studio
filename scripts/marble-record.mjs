// Read-only observer: numeric evidence, never a controller or physical accuracy proof.
// node scripts/marble-record.mjs ws://127.0.0.1:4319 captures/spatial-s2/physical-session.jsonl
import { createWriteStream } from 'node:fs'
import { WebSocket } from 'ws'
const url = new URL(process.argv[2] ?? 'ws://127.0.0.1:4319')
const path = process.argv[3]
if (!path) throw new Error('Provide an output .jsonl path in the ignored captures directory.')
url.searchParams.set('role', 'browser-spatial')
const output = createWriteStream(path, { flags: 'wx' })
const socket = new WebSocket(url)
let stopped = false, count = 0, lastState = ''
function stop() { if (stopped) return; stopped = true; socket.close(); output.end(); console.log(`Recorded ${count} numeric messages to ${path}.`) }
output.on('error', (error) => { console.error(error.message); process.exitCode = 1; stop() })
output.write(JSON.stringify({ schema: 'phone3d.marble.observer.v2', startedAtMs: Date.now(), evidence: 'Numeric observer states only. Not physical accuracy or visible latency proof.' }) + '\n')
socket.on('open', () => socket.send(JSON.stringify({ type: 'world-hello', protocolVersion: 2 })))
socket.on('message', (data) => {
  if (stopped) return
  const value = JSON.parse(data.toString())
  if (!output.write(JSON.stringify({ receivedAtMs: Date.now(), ...value }) + '\n')) {
    console.error('Recorder storage cannot keep up; ending capture rather than accumulating data.'); stop(); return
  }
  count++
  if (value.type === 'world-snapshot') {
    socket.send(JSON.stringify({ type: 'world-ack', protocolVersion: 2, worldId: value.worldId, sequence: value.sequence }))
    const state = `${value.source}/${value.phase}/${value.region}/contacts=${value.hitCount}`
    if (state !== lastState) { lastState = state; console.log(state, value.reason) }
  }
})
socket.on('error', (error) => { console.error(error.message); process.exitCode = 1; stop() })
socket.on('close', stop)
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
