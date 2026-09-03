export function h264OnlyCodecPreferences(
  capabilities: RTCRtpCapabilities | null,
) {
  if (!capabilities) return null

  const h264Codecs = capabilities.codecs.filter(
    (codec) => codec.mimeType.toLowerCase() === 'video/h264',
  )

  return h264Codecs.length > 0 ? h264Codecs : null
}
