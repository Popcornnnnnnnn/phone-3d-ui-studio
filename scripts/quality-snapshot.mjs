import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { qualitySnapshotResultError } from './quality-snapshot-contract.mjs'

const [device, output, bitRateMbps] = process.argv.slice(2)
if (!device || !output || ![4, 5].includes(process.argv.length)) {
  throw new Error('Usage: node scripts/quality-snapshot.mjs DEVICE_ID NEW_OUTPUT_DIR [BITRATE_MBPS]')
}
if (bitRateMbps !== undefined &&
    (!/^\d+$/.test(bitRateMbps) || Number(bitRateMbps) < 1 || Number(bitRateMbps) > 20)) {
  throw new Error('BITRATE_MBPS must be an integer from 1 to 20')
}
const destination = resolve(output)
if (existsSync(destination)) throw new Error('Output already exists; refusing to overwrite')
const snapshotURL = new URL('http://127.0.0.1:4319/quality/snapshot')
if (bitRateMbps !== undefined) snapshotURL.searchParams.set('averageBitRateMbps', bitRateMbps)
const response = await fetch(snapshotURL, {
  method: 'POST', headers: { 'x-phone3d-quality-probe': '1' }, signal: AbortSignal.timeout(15000),
})
const result = await response.json()
if (!response.ok) throw new Error(result.error ?? `HTTP ${response.status}`)
const error = qualitySnapshotResultError(result, result.runId)
if (error) throw new Error(error)
mkdirSync(destination, { recursive: true })
const transfer = spawnSync('xcrun', ['devicectl', 'device', 'copy', 'from',
  '--device', device, '--source', result.relativePath,
  '--destination', destination, '--domain-type', 'appDataContainer',
  '--domain-identifier', 'com.phone3dui.studio', '--timeout', '30'],
  { stdio: 'inherit', timeout: 35000 })
if (transfer.error || transfer.status !== 0) {
  // Keep exact source identity so a failed transfer can resume without recapture.
  writeFileSync(resolve(destination, 'transfer-pending.json'), JSON.stringify(result, null, 2), { flag: 'wx' })
  throw new Error(`Transfer failed; original sample remains at ${result.relativePath}. No automatic retry.`)
}
console.log(JSON.stringify({ ...result, destination }, null, 2))
