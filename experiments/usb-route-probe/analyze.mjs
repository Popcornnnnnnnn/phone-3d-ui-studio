import fs from 'node:fs'

const inputPath = process.argv[2]
if (!inputPath) {
  process.stderr.write('usage: node analyze.mjs <probe.ndjson>\n')
  process.exit(2)
}

const events = fs.readFileSync(inputPath, 'utf8')
  .split('\n')
  .filter(Boolean)
  .flatMap((line, index) => {
    try {
      return [{ ...JSON.parse(line), line: index + 1 }]
    } catch {
      return []
    }
  })

function normalizedAddress(address) {
  return String(address ?? '')
    .toLowerCase()
    .replace(/^::ffff:/, '')
    .split('%')[0]
}

function routeClass(address, payload = null) {
  if (payload?.usesWiredEthernet === true && payload?.usesWiFi !== true) {
    return 'usb-wired-ethernet-proved'
  }
  if (payload?.usesWiFi === true) return 'wifi-interface-proved'
  const normalized = normalizedAddress(address)
  if (normalized.startsWith('169.254.') || normalized.startsWith('fe80:')) {
    return 'usb-link-local-candidate'
  }
  if (normalized.startsWith('192.168.20.')) return 'wifi-private-lan'
  if (normalized === '127.0.0.1' || normalized === '::1') return 'loopback'
  return normalized ? 'other' : 'missing'
}

const evidence = events
  .filter((event) => event.event === 'payload' || event.event === 'ws-payload')
  .filter((event) => event.payload && typeof event.payload === 'object')
  .map((event) => ({
    label: event.payload.label ?? null,
    protocol: event.event === 'ws-payload' ? 'urlsession-websocket' : 'nwconnection-tcp',
    serverPeerAddress: event.remoteAddress ?? null,
    serverPeerRoute: routeClass(event.remoteAddress, event.payload),
    serverLocalAddress: event.localAddress ?? null,
    iOSLocalEndpoint: event.payload.localEndpoint ?? null,
    iOSRemoteEndpoint: event.payload.remoteEndpoint ?? null,
    usesWiFi: event.payload.usesWiFi ?? null,
    usesWiredEthernet: event.payload.usesWiredEthernet ?? null,
    usesOther: event.payload.usesOther ?? null,
    availableInterfaces: event.payload.availableInterfaces ?? null,
    sourceLine: event.line,
  }))

const byLabel = new Map(evidence.map((item) => [item.label, item]))
const usbConstraints = ['local-wired', 'local-nonwifi', 'local-other']
  .map((label) => byLabel.get(label))
  .filter(
    (item) =>
      item?.serverPeerRoute === 'usb-wired-ethernet-proved' &&
      item.usesWiredEthernet === true &&
      item.usesWiFi === false,
  )

const validNWControls =
  byLabel.get('wifi-control')?.serverPeerRoute === 'wifi-private-lan' &&
  byLabel.get('usb-control')?.serverPeerRoute === 'usb-link-local-candidate'
const validWebSocketControls =
  byLabel.get('ws-wifi-control')?.serverPeerRoute === 'wifi-private-lan' &&
  byLabel.get('ws-usb-control')?.serverPeerRoute === 'usb-link-local-candidate'

const result = {
  validControls: validNWControls || validWebSocketControls,
  validNWControls,
  validWebSocketControls,
  forgeLocalDefaultRoute: byLabel.get('local-default')?.serverPeerRoute ?? 'missing',
  forgeLocalWebSocketRoute: byLabel.get('ws-local-default')?.serverPeerRoute ?? 'missing',
  provedUSBConstraints: usbConstraints.map((item) => item.label),
  evidence,
}

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
