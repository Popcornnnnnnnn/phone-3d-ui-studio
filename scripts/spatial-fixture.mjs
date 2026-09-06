// Explicit synthetic producer for browser acceptance; never physical evidence.
// Feed one JSON command per stdin line: {"position":[0.2,0,0]}, {"rotation":[0,0,0,1]},
// {"state":"limited"}, {"pause":true}, {"pause":false}. Ctrl-D exits.
import { createInterface } from 'node:readline'
import { WebSocket } from 'ws'
import { Quaternion, Vector3 } from 'three'
const endpoint = new URL(process.argv[2] ?? 'ws://127.0.0.1:14319')
endpoint.searchParams.set('role', 'phone-spatial')
endpoint.searchParams.set('sessionId', 'fixture-' + Date.now())
const socket = new WebSocket(endpoint)
const marble = process.argv.includes('--marble')
let position = [0, 0, 0], rotation = [-Math.SQRT1_2, 0, 0, Math.SQRT1_2]
let state = 'normal', paused = false, sequence = 0
const scale = 0.14961 / 3
const cameraInBody = new Vector3(0.43 * scale, 1.08 * scale, -0.00795 / 2 - 0.046 * scale)
const bodyFromCamera = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), -Math.PI / 2)
const interval = setInterval(() => {
  if (paused || socket.readyState !== 1) return
  const body = new Quaternion(...rotation)
  socket.send(JSON.stringify({
    type: 'spatial-pose', source: 'fixture', sessionId: endpoint.searchParams.get('sessionId'),
    sequence: ++sequence, sampledAtMs: Date.now(), trackingState: state,
    reason: state === 'normal' ? 'Synthetic test input' : 'Synthetic tracking interruption',
    clockOffsetMs: marble ? 0 : null, clockRttMs: marble ? 0 : null,
    positionMeters: new Vector3(...position).add(cameraInBody.clone().applyQuaternion(body)).toArray(),
    quaternion: body.multiply(bodyFromCamera).toArray(),
  }))
}, 1000 / 60)
socket.on('open', () => {
  if (marble) socket.send(JSON.stringify({ type: 'world-hello', protocolVersion: 1 }))
  process.stdout.write('Synthetic spatial producer connected. Commands accepted on stdin.\n')
})
let worldState = ''
socket.on('message', (bytes) => {
  const value = JSON.parse(bytes.toString())
  if (value.type === 'world-snapshot') {
    socket.send(JSON.stringify({ type: 'world-ack', protocolVersion: 1, worldId: value.worldId, sequence: value.sequence }))
    const state = `${value.phase}/${value.region}/${value.canReturn}/${value.catchCount}`
    if (state !== worldState) { worldState = state; process.stdout.write(JSON.stringify({ syntheticWorld: state, ball: value.ball?.position }) + '\n') }
  }
})
socket.on('error', (error) => process.stderr.write(error.message + '\n'))
const input = createInterface({ input: process.stdin })
input.on('line', (line) => {
  try {
    const command = JSON.parse(line)
    if (command.position) position = command.position
    if (command.rotation) rotation = command.rotation
    if (command.state) state = command.state
    if (typeof command.pause === 'boolean') paused = command.pause
    process.stdout.write(JSON.stringify({ position, rotation, state, paused }) + '\n')
  } catch { process.stderr.write('Expected a JSON command.\n') }
})
input.on('close', () => { clearInterval(interval); socket.close() })
