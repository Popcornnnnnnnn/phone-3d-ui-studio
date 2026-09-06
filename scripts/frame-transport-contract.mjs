export function parseFrameTransportConfiguration(parameters) {
  const route = parameters.get('route')
  const window = parameters.get('window')
  if (!['wifi-only', 'wired-preferred'].includes(route) || !['1', '2', '3'].includes(window)) return null
  return { route, window: Number(window) }
}

// A static SCK display can emit no video frames for minutes. An identified raw
// connection is still live while its matching producer sends capture heartbeats.
export function rawFrameLivenessExpired(details, poseSources, now) {
  const last = details.lastFrameAtMs ?? details.lastActivityAtMs
  if (Number.isFinite(last) && now - last <= 5_000) return false
  const matchingHeartbeat = details.producerIdentityValid === true && poseSources.some((pose) =>
    pose.producerIdentityValid === true &&
    pose.producerSessionId === details.producerSessionId &&
    pose.captureSource === details.captureSource &&
    pose.lastCaptureState === 'streaming' &&
    Number.isFinite(pose.lastCaptureHeartbeatAtMs) &&
    now - pose.lastCaptureHeartbeatAtMs >= 0 && now - pose.lastCaptureHeartbeatAtMs < 2_500)
  return !matchingHeartbeat
}

export function wirelessSampleErrors(diagnostics, configurationId, window, addresses, now) {
  const errors = []
  const encoder = diagnostics.encoderSamples?.at(-1)
  if (!encoder || !Number.isFinite(encoder.bridgeReceivedAtMs) || now - encoder.bridgeReceivedAtMs > 2_500 || encoder.bridgeReceivedAtMs > now + 250) return ['stale-encoder']
  if (encoder.appForeground !== true) errors.push('phone-app-not-foreground')
  if (encoder.frameTransportConfigurationId !== configurationId) errors.push('configuration-id')
  if (encoder.frameAckWindow !== window) errors.push('window')
  if (encoder.frameSocketRoutePreference !== 'wifi-only' || encoder.frameSocketRouteUsesWiFi !== true ||
      encoder.frameSocketRouteUsesWiredEthernet !== false) errors.push('phone-video-route')
  if (encoder.encoderAverageBitRate !== 15_000_000 || encoder.captureWidthActive !== 960 || encoder.captureHeightActive !== 2088 ||
      encoder.encoderMediaTimeline !== 'source-timestamps-v1') errors.push('picture-configuration')
  if (encoder.thermalState !== 'nominal') errors.push('thermal-state')
  if (diagnostics.activeBenchmark?.phase === 'running' &&
      (encoder.benchmarkStimulusVisible !== true ||
       encoder.benchmarkStimulusID !== diagnostics.activeBenchmark.runId)) errors.push('phone-stimulus-not-verified')
  for (const role of ['raw-frame', 'phone-pose']) {
    const connections = diagnostics.phoneTransports?.filter((item) => item.role === role) ?? []
    if (connections.length !== 1 || !addresses.includes(connections[0]?.localAddress?.replace(/^::ffff:/, ''))) {
      errors.push(`mac-${role}-route`)
    }
  }
  return errors
}
