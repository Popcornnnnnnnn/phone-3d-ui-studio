export function vp8OnlyCodecPreferences(
  capabilities: RTCRtpCapabilities | null,
) {
  if (!capabilities) return null

  const vp8Codecs = capabilities.codecs.filter(
    (codec) => codec.mimeType.toLowerCase() === 'video/vp8',
  )

  return vp8Codecs.length > 0 ? vp8Codecs : null
}
