import { randomUUID } from 'node:crypto'
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import { summarizeBenchmarkGroups } from './benchmark-statistics.mjs'

export function acceptedBenchmarkPayload(latest, runId) {
  const benchmark = latest?.benchmark
  if (
    benchmark?.runId !== runId ||
    benchmark.report?.runId !== runId
  ) {
    return null
  }
  return {
    report: benchmark.report,
    phoneFrameTransport: benchmark.phoneFrameTransport ?? null,
    phoneControlTransport: benchmark.phoneControlTransport ?? null,
  }
}

export function buildBenchmarkOutput(results, ranked, failureSummary = null) {
  const ok = failureSummary === null
  const groupedSummary = summarizeBenchmarkGroups(results)
  return {
    ok,
    results,
    ranked: ok ? ranked : [],
    groupedSummary: {
      ...groupedSummary,
      sweepComplete: ok,
      ranked: ok ? groupedSummary.ranked : [],
    },
    ...(ok ? {} : { failure: failureSummary }),
  }
}

export async function writeBenchmarkOutput(outputPath, outputText) {
  if (typeof outputPath !== 'string' || outputPath.trim().length === 0) {
    return false
  }

  const targetPath = resolve(outputPath)
  const parentPath = dirname(targetPath)
  const temporaryPath = resolve(
    parentPath,
    `.${basename(targetPath)}.${process.pid}.${randomUUID()}.tmp`,
  )
  await mkdir(parentPath, { recursive: true })
  try {
    await writeFile(temporaryPath, outputText, {
      encoding: 'utf8',
      flag: 'wx',
    })
    await rename(temporaryPath, targetPath)
  } catch (error) {
    await unlink(temporaryPath).catch(() => {})
    throw error
  }
  return true
}
