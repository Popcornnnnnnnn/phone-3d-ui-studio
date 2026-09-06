import { execFile } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import {
  acceptedBenchmarkPayload,
  buildBenchmarkOutput,
  writeBenchmarkOutput,
} from './benchmark-output.mjs'

const execFileAsync = promisify(execFile)
const benchmarkSweepPath = fileURLToPath(
  new URL('./benchmark-sweep.mjs', import.meta.url),
)

describe('benchmark output persistence', () => {
  it('retains authoritative bridge transport evidence with an accepted report', () => {
    const report = { runId: 'route-run' }
    const phoneFrameTransport = {
      role: 'raw-frame',
      remoteAddress: '169.254.131.86',
      addressScope: 'ipv4-link-local',
    }
    const phoneControlTransport = {
      role: 'phone-pose',
      remoteAddress: '192.168.20.98',
      addressScope: 'ipv4-private-lan',
    }
    expect(
      acceptedBenchmarkPayload(
        {
          benchmark: {
            runId: 'route-run',
            report,
            phoneFrameTransport,
            phoneControlTransport,
          },
        },
        'route-run',
      ),
    ).toEqual({ report, phoneFrameTransport, phoneControlTransport })
    expect(
      acceptedBenchmarkPayload(
        { benchmark: { runId: 'stale-run', report } },
        'route-run',
      ),
    ).toBeNull()
  })

  it('keeps failure summaries but clears partial rankings', () => {
    const failure = { index: 2, message: 'benchmark failed' }
    const accepted = { runId: 'accepted' }
    expect(buildBenchmarkOutput([accepted], [accepted], failure)).toEqual({
      ok: false,
      results: [accepted],
      ranked: [],
      groupedSummary: expect.objectContaining({
        sweepComplete: false,
        groups: expect.any(Array),
        ranked: [],
      }),
      failure,
    })
  })

  it('keeps rankings for a complete successful output', () => {
    const accepted = { runId: 'accepted' }
    expect(buildBenchmarkOutput([accepted], [accepted])).toEqual({
      ok: true,
      results: [accepted],
      ranked: [accepted],
      groupedSummary: expect.objectContaining({
        sweepComplete: true,
        groups: expect.any(Array),
        ranked: expect.any(Array),
      }),
    })
  })

  it('does nothing unless an output path is explicitly configured', async () => {
    await expect(writeBenchmarkOutput(undefined, '{}\n')).resolves.toBe(false)
  })

  it('creates parents and atomically replaces the final JSON file', async () => {
    const temporaryDirectory = await mkdtemp(
      join(tmpdir(), 'phone-3d-benchmark-output-'),
    )
    const outputDirectory = join(temporaryDirectory, 'nested')
    const outputPath = join(outputDirectory, 'result.json')
    try {
      await expect(
        writeBenchmarkOutput(outputPath, '{"ok":true,"run":1}\n'),
      ).resolves.toBe(true)
      expect(await readFile(outputPath, 'utf8')).toBe('{"ok":true,"run":1}\n')

      await writeBenchmarkOutput(outputPath, '{"ok":false,"run":2}\n')
      expect(await readFile(outputPath, 'utf8')).toBe('{"ok":false,"run":2}\n')
      expect(await readdir(outputDirectory)).toEqual(['result.json'])
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true })
    }
  })

  it.each([
    {
      name: 'configuration parsing',
      arguments: ['invalid-configuration'],
      environment: {},
      phase: 'configuration',
    },
    {
      name: 'the initial bridge health preflight',
      arguments: ['30:low-latency'],
      environment: { PHONE_BRIDGE_HTTP: 'not-a-valid-url' },
      phase: 'preflight',
    },
  ])(
    'atomically replaces stale output when $name fails',
    async ({ arguments: sweepArguments, environment, phase }) => {
      const temporaryDirectory = await mkdtemp(
        join(tmpdir(), 'phone-3d-benchmark-failure-output-'),
      )
      const outputPath = join(temporaryDirectory, 'result.json')
      try {
        await writeBenchmarkOutput(
          outputPath,
          '{"ok":true,"stale":true}\n',
        )

        await expect(
          execFileAsync(process.execPath, [benchmarkSweepPath, ...sweepArguments], {
            env: {
              ...process.env,
              ...environment,
              BENCHMARK_OUTPUT_PATH: outputPath,
            },
          }),
        ).rejects.toMatchObject({ code: 1 })

        const output = JSON.parse(await readFile(outputPath, 'utf8'))
        expect(output).toMatchObject({
          ok: false,
          results: [],
          ranked: [],
          groupedSummary: {
            sweepComplete: false,
            groups: [],
            ranked: [],
          },
          failure: {
            phase,
            index: null,
            configuration: null,
            retryCount: 0,
            attempts: [],
          },
        })
        expect(output.failure.message).toEqual(expect.any(String))
        expect(await readdir(temporaryDirectory)).toEqual(['result.json'])
      } finally {
        await rm(temporaryDirectory, { recursive: true, force: true })
      }
    },
  )
})
