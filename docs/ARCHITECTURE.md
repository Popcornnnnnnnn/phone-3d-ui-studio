# Spatial architecture — S1 and S2.1

## Runtime ownership

- iPhone SwiftUI owns the selected mode. A separate ARKit controller owns camera permission, ARSession, foreground lifecycle and a spatial LiveSocket instance. Screen capture is stopped before spatial mode becomes available; late capture-picker updates are gated when that mode is inactive.
- The Node bridge routes `phone-spatial` to `browser-spatial` independently of the existing video leases. One spatial producer owns a connection generation; replacement and reconnect invalidate browser calibration.
- The Web spatial workspace owns calibration, freshness and rendering. Pose updates go through refs and an imperative tracker. React status refresh is capped at 10 Hz.

## Spatial wire contract

`spatial-pose` and `spatial-status` carry source (`arkit` or explicitly marked `fixture`), sessionId, monotonically increasing sequence, sampledAtMs, trackingState, reason, and optional clockOffsetMs/clockRttMs. Pose packets additionally carry camera positionMeters and quaternion `[x,y,z,w]`. Status packets work without a pose, including denied permission and paused sessions.

The bridge announces `spatial-link` with sessionId and a new connectionId, binds messages to that producer, adds connectionId and bridgeReceivedAtMs, and drops malformed/out-of-order packets. Only the allow-listed metadata fields are relayed. The existing clock-sync exchange is available on the spatial socket. Spatial routes do not acquire video leases or request video keyframes.

Each accepted spatial packet receives a private spatial-ack. Native flow control allows one unacknowledged packet and one replaceable latest packet, because URLSession send completion alone only proves local buffering. A one-second missing receipt reconnects the transport. A 16 KiB browser send threshold bounds browser user-space queues. A congested lifecycle announcement closes the browser connection so it can reconnect with current identity instead of missing a generation change. Bridge shutdown closes spatial clients too.

## Coordinate contract

ARKit camera transforms are right-handed and use a fixed device basis: camera X points toward the phone bottom, Y toward its right and Z out of its screen. Camera-from-body rotation is a fixed +90 degrees about Z. Body position subtracts the camera lever arm rotated by body orientation.

The lever arm is an explicit geometric approximation of the existing model main-camera marker, not calibrated hardware extrinsics. Raw camera and estimated body data remain separate. All spatial calculations use meters. Existing three-unit model geometry is scaled by `0.14961 / 3`.

Origin calibration removes translation and yaw only. It projects the phone's top edge onto the horizontal plane and maps it toward workspace -Z, preserving roll and pitch. A near-vertical top edge cannot define heading and is rejected with a hold-screen-up instruction. The calibrated body starts at `[0,0.2,0]`; this is a display reference and does not measure the tabletop.

Spatial rendering has exclusive transform ownership. The reused phone model's grounded-height compensation, pose prediction, ambient animation and orientation presentation adjustments do not run. The observation camera never follows the phone.

## Failure handling and evidence

Non-normal tracking or 250 ms without a valid pose invalidates calibration and freezes the last rendered transform. Fresh tracking cannot move it until Set origin is used again. ARSession restarts, network reconnection, page reload and backgrounding require another calibration. Old-session and old-connection messages are ignored.

Numeric recording stores received camera samples and CPU render submissions separately, with bounded retention and explicit dropped-record counts. Cross-device sample age is shown only with available low-RTT clock synchronization. Software timing is not photon latency; numeric traces do not establish physical accuracy.

Camera imagery never enters the spatial transport. The previous media architecture is preserved as a [historical supporting-track reference](legacy/live-twin-architecture.md).


## S2.1 authoritative world

Shared phone geometry and spatial math retain the S1 metric and yaw-only calibration contract. S1 owns its browser origin; Marble calibration belongs to the bridge. Switching Tracking / Marble unmounts the previous client.

`MarbleService` lazily initializes pinned `@dimforge/rapier3d-compat@0.20.0`. `MarbleWorld` uses 120 Hz fixed steps, 1.5 m/s² gravity, 7.5 mm radius spheres and the existing shallow rounded tray with a 40 mm right exit. The tray receives next-step kinematic transforms interpolated between received poses. No future motion is predicted. Restitution is 0.5 for the active ball and floor, 0.2 for rails, 0.1 for the ground, with Min combination. Linear/angular damping dissipates energy.

Each explicit addition creates a new UUID at the current calibrated tray center; only one ball is active. Actual front-floor contact after at least 40 ms separation increments a sequenced impact event. Resting contact cannot repeatedly vibrate. First ground contact retires the ball and restricts collisions to ground only. After settling it becomes a saved visual pose with no rigid body. At five retained balls, addition removes the oldest ground record. Out-of-bounds balls are removed and require explicit replacement. There is no Return, attraction, automatic launch or automatic reset.

`world-hello` version 2 declares capabilities. Complete snapshots carry balls[], activeBallId, canAddBall, hitCount and lastImpact along with world/epoch/sequence, bridge time, phase, owner, current phone identity, source and geometry. Old S2 clients receive a v1-compatible unsupported/upgrade notice; S1 and mirroring protocols remain unchanged. Removed/invalid commands return rejection. Unique command IDs are deduplicated in a bounded cache. The current phone sends Add ball through reliable `sendControl`, never the coalescing pose path. The first Web Start claims control; other pages observe. Owner disconnect/hide pauses; takeover starts a newly calibrated round.

Snapshot delivery retains one unacknowledged and one latest pending packet per consumer. The unchanged 250 ms pose/display/clock gates freeze the world; 1 s without receipts closes the socket. Backgrounding and reconnect require explicit recalibration. Paused time is not simulated later.

Both clients interpolate phone and balls at bridge time minus 50 ms. Identity-based interpolation prevents a removed ball from morphing into a new one; births, retirements and impact metadata become visible at their sample time. Native haptics fire at presentation, once per impact sequence, and do not replay stale events. Native Canvas and Web imperative buffers avoid publishing high-frequency snapshots as application UI state.

Projection intersects a sphere with the **finite** local slab `[screenZ - radius, screenZ]`, then clips to the rounded display. If the center is distance d from that slab, the projected radius is `sqrt(r²-d²)` for d < r, otherwise zero. Web 3D fragments use the complementary finite-volume clipping, including the same rounded XY boundary. Ground traces have ordinary un-clipped world materials and are never painted onto the phone. This fixes the previous infinite-depth projection and clipping defect.

The iPhone connects to the existing LAN WebSocket `ws://forge.local:4319/`. Spatial transport does not bind to USB and does not carry camera images. Wi-Fi and USB use the same protocol; successful USB testing does not prove wireless acceptance. See [S2.1 verification](ELASTIC_TRAY.md). Camera-to-body geometry remains approximate.
