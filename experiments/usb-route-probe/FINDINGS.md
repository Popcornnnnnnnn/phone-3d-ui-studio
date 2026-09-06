# USB route findings (2026-09-04)

## Evidence collected on this Mac

At 17:44 local time, while the iPhone USB network link was present:

- `en0` (Wi-Fi) was `192.168.20.61`.
- `en7` was active at `169.254.65.18/16`, media `100baseTX
  <full-duplex>`.
- the iPhone neighbor was `169.254.131.86`; `route -n get
  169.254.131.86` selected `en7`.
- `dns-sd -G v4v6 forge.local` returned both `192.168.20.61` on en0 and
  `169.254.65.18` on en7, plus an IPv6 link-local record on each interface.

At 17:49, `en7` disappeared and `devicectl` reported the iPhone unavailable.
The en7 records also disappeared from `dns-sd`. This is evidence that the USB
address and interface are dynamic device-link state, not product constants.

The contemporaneous Wi-Fi control was poor: 20 ICMP samples to
`192.168.20.98` had 0% loss but 4.528/134.508/327.419 ms
min/mean/max and 121.600 ms standard deviation.

## What `forge.local` does and does not prove

`forge.local` is a good stable identity for the Mac. It makes both Wi-Fi and
USB link-local addresses eligible while each interface is present. It does not
encode a route preference, and neither mDNS nor the public Network.framework
contract promises that the default connection will choose USB over Wi-Fi.

Therefore replacing the literal Wi-Fi IP with `forge.local` is useful discovery
work, but is not a verified USB optimization by itself. The selected path must
be measured on the iPhone and corroborated by the Mac's accepted peer address.

## Public SDK capability boundary

The Xcode 27 beta SDK exposes the required tools in these installed files:

- `Network.framework/Headers/connection.h`: connected
  `nw_connection_copy_current_path` and path update handler.
- `Network.framework/Headers/path.h`: interface enumeration and
  `nw_path_uses_interface_type`.
- `Network.framework/Headers/interface.h`: public interface name, index, and
  type. There is no `.usb` interface type.
- `Network.framework/Headers/parameters.h`: require/prohibit a concrete
  interface or interface type, and require a local endpoint.
- `Foundation.framework/Headers/NSURLSession.h`: URLSession transaction
  metrics expose local/remote address and port only after metrics collection.

The corresponding Swift API is available on iOS 12+ for Network.framework:

- `NWConnection.currentPath`
- `NWPath.availableInterfaces`
- `NWPath.usesInterfaceType(_:)`
- `NWInterface.name`, `index`, and `type`
- `NWParameters.requiredInterface`
- `NWParameters.requiredInterfaceType`
- `NWParameters.prohibitedInterfaces`
- `NWParameters.prohibitedInterfaceTypes`
- `NWParameters.requiredLocalEndpoint`

`NWParameters.includePeerToPeer` controls Bonjour peer-to-peer discovery. It is
not a USB switch and is ignored when a concrete required interface is set.

`URLSessionWebSocketTask` has no public `NWParameters`, `requiredInterface`, or
live `currentPath` hook. It can only be verified after the fact through
`URLSessionTaskMetrics` local/remote addresses, or replaced with
`NWConnection + NWProtocolWebSocket.Options` if a hard route constraint is
required.

## Current product implication

The latency-sensitive frame transport already uses a raw `NWConnection` to
bridge port 4320, with `TCP_NODELAY`. This is the easiest and most valuable path
to constrain. The control/pose transport still uses `URLSessionWebSocketTask`
on port 4319 and cannot be precisely interface-bound without a transport change.

The bridge already retains each raw frame socket's `remoteAddress`; exposing
that address in diagnostics makes the Mac-side route proof cheap. The iPhone
should additionally publish the frame connection's path endpoints and selected
interface name/type/index in its status heartbeat.

The current bridge binds `0.0.0.0`, so ports 4319/4320 are IPv4-only even
though `forge.local` also has per-interface IPv6 link-local records. Before
shipping hostname discovery, bind a dual-stack listener (`::` with IPv4-mapped
connections enabled on macOS) or intentionally prove the resolver's IPv4
fallback. Otherwise a failed IPv6 candidate can inflate reconnect time even if
the eventual steady-state stream uses USB IPv4.

## Minimum product change, gated by the probe

1. Change bridge identity from the literal Wi-Fi IP to `forge.local` for both
   ports.
2. Make the bridge listener dual-stack and verify both en0 and the USB
   link-local interface are accepted.
3. On `LowLatencyFrameSocket` `.ready`, record `currentPath.localEndpoint`,
   `remoteEndpoint`, `availableInterfaces`, and all relevant
   `usesInterfaceType` flags. Surface them in status diagnostics.
4. Run this probe with Wi-Fi still enabled. If the USB connection reports
   `.wiredEthernet`, use `requiredInterfaceType = .wiredEthernet` for port 4320
   and fall back to an unconstrained `.local` connection only when that path is
   unavailable.
5. If USB reports `.other`, do not constrain the whole `.other` class. Discover
   the concrete USB-side `NWInterface`, then use
   `NWParameters.requiredInterface = interface`. VPN/AWDL and other links can
   also be `.other`.
6. Keep control/pose on URLSession initially and record transaction metrics.
   If it remains a meaningful latency or reliability source, migrate only that
   socket to Network.framework WebSocket so it can share the exact interface
   policy.

## A/B acceptance method

Keep the phone, Mac, capture resolution, encoder mode, and scene constant. For
each route run at least three interleaved repetitions:

1. literal Wi-Fi control (`192.168.20.61`);
2. unconstrained `forge.local`;
3. USB-constrained `forge.local` using the interface policy proved by the
   probe;
4. USB-constrained route with Wi-Fi disabled only as a route-control, not as the
   proposed product behavior.

A run is labeled USB only if both sides agree:

- iPhone `NWConnection.currentPath` selects the probed USB interface and has a
  link-local endpoint;
- bridge accepted peer address is the iPhone link-local address.

Compare run-group median and worst capture-to-render P95, frame ACK RTT,
phone-to-bridge time, reconnect time, throughput/drop/reset counts, and thermal
state. Reject any run whose route evidence is missing or whose thermal state is
contaminated. A USB policy should ship only if it improves tail latency or
stability without increasing reset/drop rate.
