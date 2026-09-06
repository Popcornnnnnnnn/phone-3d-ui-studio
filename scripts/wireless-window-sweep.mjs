// Bounded 1/2/3-window experiment. Uses the existing physical-device benchmark;
// rejects route/configuration changes and never treats loopback tests as Wi-Fi.
import { spawn, execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { networkInterfaces } from 'node:os'
import { resolve, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { wirelessSampleErrors } from './frame-transport-contract.mjs'
import { summarizeTransportTrace } from './transport-trace.mjs'

const [outputArgument, ...windowArguments] = process.argv.slice(2)
if (!outputArgument || windowArguments.some((item) => !['1', '2', '3'].includes(item)) || windowArguments.length > 4) {
  throw new Error('Usage: node scripts/wireless-window-sweep.mjs NEW_OUTPUT_DIR [1 2 3]')
}
const windows = windowArguments.length ? windowArguments.map(Number) : [1, 2, 3]
const durationMs = Number(process.env.WIRELESS_DURATION_MS ?? 10_000)
if (!Number.isSafeInteger(durationMs) || durationMs < 10_000 || durationMs > 60_000) {
  throw new Error('WIRELESS_DURATION_MS must be an integer from 10000 to 60000')
}
const root = resolve(import.meta.dirname, '..')
const output = resolve(outputArgument)
const bridge = process.env.PHONE_BRIDGE_HTTP ?? 'http://127.0.0.1:4319'
const hardwarePorts = execFileSync('/usr/sbin/networksetup', ['-listallhardwareports'], { encoding: 'utf8' })
const wifiInterface = hardwarePorts.match(/Hardware Port: (?:Wi-Fi|AirPort)\r?\nDevice: (\S+)/)?.[1]
const wifiAddresses = (networkInterfaces()[wifiInterface] ?? []).map((item) =>
  item.address.startsWith('fe80:') && !item.address.includes('%') ? `${item.address}%${wifiInterface}` : item.address)
if (!wifiInterface || !wifiAddresses.length) throw new Error('Mac Wi-Fi interface is not available')
const json = async (path, init) => {
  const response = await fetch(`${bridge}${path}`, { ...init, signal: AbortSignal.timeout(5_000) })
  const body = await response.json()
  if (!response.ok) throw new Error(`${path}: ${body.error ?? response.status}`)
  return body
}
const health = await json('/health')
if (health.phones !== 1 || health.phonePose !== 1 || health.browsers !== 1) {
  throw new Error('Need one sharing phone and one Chrome receiver; no automatic reconnect loop')
}
const preflight = await json('/diagnostics')
const currentEncoder = preflight.encoderSamples?.at(-1)
const preflightErrors = wirelessSampleErrors(preflight, currentEncoder?.frameTransportConfigurationId,
  currentEncoder?.frameAckWindow, wifiAddresses, Date.now())
if (preflightErrors.length) throw new Error(`Preflight not ready: ${preflightErrors.join(', ')}; no device command sent`)
await mkdir(output) // Deliberately fails for an existing directory.
const runs = []
let failure = null
try {
  for (const [index, window] of windows.entries()) {
    console.log(`Preparing Wi-Fi, window ${window} (${index + 1}/${windows.length})`)
    const configuration = await json(`/transport/config?route=wifi-only&window=${window}`, {
      method: 'POST', headers: { 'x-phone3d-transport-probe': '1' },
    })
    let prepared = false
    let lastErrors = []
    const deadline = Date.now() + 10_000
    while (Date.now() < deadline) {
      const diagnostics = await json('/diagnostics')
      lastErrors = wirelessSampleErrors(diagnostics, configuration.runId, window, wifiAddresses, Date.now())
      if (lastErrors.includes('phone-app-not-foreground')) throw new Error('Phone app left foreground during preparation; stop for user action')
      if (!lastErrors.length) { prepared = true; break }
      await delay(500)
    }
    if (!prepared) throw new Error(`Configuration/route not verified: ${lastErrors.join(', ')}`)
    let traceCursor = (await json('/transport/trace')).cursor
    const traceRecords = []
    let traceGap = false
    const collectTrace = async () => {
      const batch = await json(`/transport/trace?after=${traceCursor}`)
      if (batch.earliestCursor !== null && batch.earliestCursor > traceCursor + 1) traceGap = true
      if (batch.records.some((record) => record.kind === 'phone-trace-gap')) traceGap = true
      traceCursor = batch.cursor
      traceRecords.push(...batch.records)
    }
    const resultPath = join(output, `${index + 1}-window-${window}.json`)
    const child = spawn(process.execPath, ['scripts/benchmark-sweep.mjs', '60:legacy:speed-priority:software:960'], {
      cwd: root,
      env: { ...process.env, BENCHMARK_OUTPUT_PATH: resultPath, BENCHMARK_DURATION_MS: String(durationMs),
        BENCHMARK_WARMUP_MS: '2000', BENCHMARK_RETRY_READY_TIMEOUT_MS: '2000', BENCHMARK_DISABLE_RETRY: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let finished = false
    let exitCode = null
    let log = ''
    for (const stream of [child.stdout, child.stderr]) stream.on('data', (chunk) => { if (log.length < 150_000) log += chunk.toString() })
    const exited = new Promise((done) => {
      child.once('error', (error) => { log += error.message; finished = true; exitCode = -1; done() })
      child.once('close', (code) => { exitCode = code; finished = true; done() })
    })
    const samples = []
    const exclusions = new Set()
    const limit = Date.now() + durationMs + 35_000
    try {
      while (!finished) {
        if (Date.now() > limit) { exclusions.add('bounded-run-timeout'); break }
        const diagnostics = await json('/diagnostics')
        await collectTrace()
        const encoder = diagnostics.encoderSamples.at(-1)
        samples.push({ at: Date.now(), phase: diagnostics.activeBenchmark?.phase ?? null,
          encoder, routes: diagnostics.phoneTransports, receiver: diagnostics.receiverSamples.at(-1) })
        if (encoder?.appForeground === false) {
          exclusions.add('phone-app-not-foreground')
          break
        }
        if (diagnostics.activeBenchmark?.phase === 'running') {
          for (const error of wirelessSampleErrors(diagnostics, configuration.runId, window, wifiAddresses, Date.now())) exclusions.add(error)
        }
        await delay(500)
      }
    } finally {
      if (!finished) child.kill('SIGTERM')
      await exited
      await delay(1_200) // Bounded heartbeat drain, outside measured FPS/latency.
      try {
        await collectTrace()
      } catch (error) {
        traceGap = true
        exclusions.add('transport-trace-drain-unavailable')
        log += `\nTrace drain failed: ${error instanceof Error ? error.message : String(error)}\n`
      }
      await writeFile(join(output, `${index + 1}-window-${window}.log`), log, { flag: 'wx' })
      await writeFile(join(output, `${index + 1}-window-${window}-telemetry.json`), JSON.stringify(samples), { flag: 'wx' })
      await writeFile(join(output, `${index + 1}-window-${window}-trace.json`),
        JSON.stringify({ traceGap, summary: summarizeTransportTrace(traceRecords), records: traceRecords }), { flag: 'wx' })
    }
    if (exitCode !== 0) throw new Error(`Window ${window}: benchmark failed; saved log, no retry`)
    const result = JSON.parse(await readFile(resultPath, 'utf8'))
    if (!samples.some((sample) => sample.phase === 'running')) exclusions.add('missing-running-route-evidence')
    if (!result.ok || result.results.length !== 1) exclusions.add('missing-accepted-result')
    const measured = result.results[0]
    if (!measured?.eligibleForRanking) exclusions.add('benchmark-ineligible')
    if (measured?.frameAckWindow !== window || measured?.decoderMaxPendingFrames !== Math.max(2, window) ||
        measured?.decoderMaxFrameAgeMs !== 75) exclusions.add('receiver-window-configuration')
    if (measured?.phoneFrameTransport?.localAddress && !wifiAddresses.includes(measured.phoneFrameTransport.localAddress.replace(/^::ffff:/, ''))) exclusions.add('accepted-frame-route')
    const entry = { window, configurationId: configuration.runId, exclusions: [...exclusions], result: measured }
    runs.push(entry)
    console.log(JSON.stringify({ window, renderedFps: measured?.renderedFps,
      captureToSubmissionP95Ms: measured?.captureToRenderP95Ms, exclusions: entry.exclusions }))
    if (exclusions.size) throw new Error(`Window ${window} is not a valid comparison; stop before expanding`)
  }
} catch (error) {
  failure = error instanceof Error ? error.message : String(error)
  process.exitCode = 1
} finally {
  await writeFile(join(output, 'summary.json'), JSON.stringify({ ok: failure === null, failure,
    evidence: 'Physical SCK source, Wi-Fi verified, Chrome render submission; not visible latency or image acceptance',
    wifiInterface, wifiAddresses, durationMs, runs }, null, 2), { flag: 'wx' })
  console.log(failure ?? 'Window sweep complete; user image acceptance and repeated confirmation remain required')
}
