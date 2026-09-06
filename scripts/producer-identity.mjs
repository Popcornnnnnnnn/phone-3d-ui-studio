export const captureSources = Object.freeze([
  'screencapturekit-host',
  'replaykit-broadcast-upload',
])

export function normalizeProducerIdentity(producerSessionId, captureSource) {
  if (
    typeof producerSessionId !== 'string' ||
    producerSessionId.length === 0 ||
    producerSessionId.length > 128 ||
    !captureSources.includes(captureSource)
  ) {
    return null
  }
  return { producerSessionId, captureSource }
}

export function producerIdentityKey(identity) {
  const normalized = normalizeProducerIdentity(
    identity?.producerSessionId,
    identity?.captureSource,
  )
  return normalized
    ? `${normalized.captureSource}:${normalized.producerSessionId}`
    : null
}

export function sameProducerIdentity(left, right) {
  const leftKey = producerIdentityKey(left)
  return leftKey !== null && leftKey === producerIdentityKey(right)
}

export function selectUniqueProducerPair(poseCandidates, frameCandidates) {
  const matches = []
  for (const pose of poseCandidates) {
    if (pose?.producerIdentityValid === false) continue
    const key = producerIdentityKey(pose)
    if (!key) continue
    for (const frame of frameCandidates) {
      if (
        frame?.producerIdentityValid !== false &&
        sameProducerIdentity(pose, frame)
      ) {
        matches.push({ key, pose, frame })
      }
    }
  }

  const distinctKeys = [...new Set(matches.map((match) => match.key))]
  if (distinctKeys.length !== 1) {
    return {
      pair: null,
      reason:
        distinctKeys.length === 0
          ? 'producer-identity-incomplete'
          : 'multiple-producer-sessions',
      distinctProducerSessions: distinctKeys.length,
    }
  }

  const selectedKey = distinctKeys[0]
  const selected = matches
    .filter((match) => match.key === selectedKey)
    .sort(
      (left, right) =>
        (right.pose.freshnessAtMs ?? 0) -
          (left.pose.freshnessAtMs ?? 0) ||
        (right.frame.freshnessAtMs ?? 0) -
          (left.frame.freshnessAtMs ?? 0),
    )[0]
  return {
    pair: selected ?? null,
    reason: selected ? null : 'producer-identity-incomplete',
    distinctProducerSessions: 1,
  }
}
