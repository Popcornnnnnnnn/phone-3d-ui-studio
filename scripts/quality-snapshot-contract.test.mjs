import { describe, expect, it } from 'vitest'
import { qualitySnapshotResultError } from './quality-snapshot-contract.mjs'

const runId = '63a63982-1f09-4b1e-903b-2fbbfd3b9d71'
const result = { runId, ok: true, relativePath: `Library/Caches/QualitySnapshots/${runId}`,
  frameId: 10, width: 960, height: 2088 }
describe('one-shot quality snapshot boundary', () => {
  it('accepts only a matching run and its exact app-cache path', () => {
    expect(qualitySnapshotResultError(result, runId)).toBeNull()
    expect(qualitySnapshotResultError({ ...result, runId: 'stale' }, runId)).toBe('snapshot-run-mismatch')
    expect(qualitySnapshotResultError({ ...result, relativePath: '../../Documents' }, runId)).toBe('snapshot-path-invalid')
  })
  it('rejects oversized or unidentified frames and preserves bounded phone failures', () => {
    expect(qualitySnapshotResultError({ ...result, width: 10000 }, runId)).toBe('snapshot-frame-invalid')
    expect(qualitySnapshotResultError({ ...result, frameId: null }, runId)).toBe('snapshot-frame-invalid')
    expect(qualitySnapshotResultError({ runId, ok: false, error: 'capture-pipeline-changed' }, runId))
      .toBe('capture-pipeline-changed')
  })
})
