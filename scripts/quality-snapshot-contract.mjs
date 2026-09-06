const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function qualitySnapshotResultError(message, runId) {
  if (!uuid.test(runId) || message?.runId !== runId) return 'snapshot-run-mismatch'
  if (message.ok === false) return typeof message.error === 'string'
    ? message.error.slice(0, 500) : 'phone-snapshot-failed'
  if (message.ok !== true) return 'snapshot-result-invalid'
  if (message.relativePath !== `Library/Caches/QualitySnapshots/${runId}`) return 'snapshot-path-invalid'
  if (!Number.isSafeInteger(message.frameId) || message.frameId < 0 ||
      !Number.isSafeInteger(message.width) || message.width <= 0 ||
      !Number.isSafeInteger(message.height) || message.height <= 0 ||
      message.width * message.height > 8_000_000) return 'snapshot-frame-invalid'
  return null
}
