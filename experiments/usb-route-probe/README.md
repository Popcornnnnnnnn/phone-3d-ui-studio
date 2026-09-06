# USB route probe

This isolated probe establishes which interface an iPhone actually selects for
`forge.local`. It does not modify the Phone 3D app or bridge.

## Why a probe is necessary

On the test Mac, mDNS publishes both the Wi-Fi address and the USB link-local
address for `forge.local`. A hostname therefore makes USB eligible, but does not
itself prove that Apple's path evaluator selects USB. The server-side peer address
is the route ground truth; the iOS `NWConnection.currentPath` fields explain the
selection.

## Run

From the repository root:

```sh
node experiments/usb-route-probe/server.mjs | tee /tmp/usb-route-probe.ndjson
```

In another shell:

```sh
xcodegen generate \
  --spec experiments/usb-route-probe/project.yml \
  --project experiments/usb-route-probe
DEVELOPER_DIR=/Applications/Xcode-27-beta.app/Contents/Developer \
  xcodebuild \
  -project experiments/usb-route-probe/USBRouteProbe.xcodeproj \
  -scheme USBRouteProbe \
  -destination 'generic/platform=iOS' \
  -derivedDataPath /tmp/usb-route-probe-derived \
  build
```

Install and launch the resulting app with Wi-Fi enabled. The matrix starts
automatically; tap **Run route matrix** only to repeat it. On first launch,
accept the iOS Local Network permission prompt.
The TCP control rows prove each physical route is reachable; the remaining rows
compare unconstrained `.local`, required wired Ethernet, Wi-Fi/cellular
prohibited, and required `other` interface policies. Three final
`URLSessionWebSocketTask` rows repeat the Wi-Fi, USB, and `.local` controls on
port 4332, matching the production control/pose transport.

Interpret the server's `remoteAddress` as follows:

- `192.168.20.x`: Wi-Fi path.
- `169.254.x.x` or the en7-scoped IPv6 peer: USB link-local path.
- no connection: the tested constraint does not describe the USB interface on
  this iPhone/OS combination.

Do not ship `requiredInterfaceType = .other` without evidence: VPN, AWDL, and
other transports can also have the `other` type. If USB appears as `other`, bind
the exact `NWInterface` discovered from `NWPath.availableInterfaces` instead.

Summarize the captured peer/path evidence with:

```sh
node experiments/usb-route-probe/analyze.mjs /tmp/usb-route-probe.ndjson
```
