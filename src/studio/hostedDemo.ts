export function isHostedStaticDemo(
  loc: Pick<Location, 'protocol' | 'hostname' | 'search'> = window.location,
): boolean {
  if (new URLSearchParams(loc.search).get('bridge')) return false
  const isLocalHost =
    loc.hostname === 'localhost' ||
    loc.hostname === '127.0.0.1' ||
    loc.hostname === '[::1]'
  return loc.protocol === 'https:' && !isLocalHost
}
